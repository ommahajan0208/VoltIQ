"""Local API. Heavy work runs only in the separately launched worker."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import duckdb
from fastapi import FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from . import store
from .peak_load import analyze_peak_rows
from .recommendations import build_recommendations

app=FastAPI(title="VoltIQ API",version="2.0")
store.init()


@app.middleware("http")
async def local_mutation_boundary(request:Request,call_next):
    if request.method not in ("GET","HEAD","OPTIONS"):
        host=urlparse("http://"+request.headers.get("host","")).hostname
        origin=request.headers.get("origin")
        allowed={"localhost","127.0.0.1","::1"}
        bad_origin=origin is not None and urlparse(origin).hostname not in {"localhost","127.0.0.1","::1"}
        expected=os.environ.get("APPLICATION_TOKEN")
        bad_token=bool(expected) and request.headers.get("x-application-token")!=expected
        if host not in allowed or bad_origin or bad_token:
            return JSONResponse(status_code=403,content={"error":{
                "code":"local_access_required","message":"Use the local application to make this change.",
                "details":None,"request_id":store.new_id("req")}})
    return await call_next(request)


def envelope(data,**meta):
    return {"data":data,"meta":{"schema_version":"2.0","time_basis":"source_local_naive",**meta}}


def fail(status:int,code:str,message:str,details=None):
    raise HTTPException(status_code=status,detail={"code":code,"message":message,"details":details})


@app.exception_handler(HTTPException)
async def http_error(request:Request,exc:HTTPException):
    d=exc.detail if isinstance(exc.detail,dict) else {"code":"http_error","message":str(exc.detail),"details":None}
    return JSONResponse(status_code=exc.status_code,content={"error":{**d,"request_id":request.headers.get("x-request-id") or store.new_id("req")}})


@app.exception_handler(ValueError)
async def value_error(request:Request,exc:ValueError):
    code="conflict" if "conflict" in str(exc) else "invalid_request"
    return JSONResponse(status_code=409 if code=="conflict" else 422,content={"error":{"code":code,"message":str(exc),"details":None,"request_id":store.new_id("req")}})


def entity(kind,id):
    out=store.get(kind,id)
    if out is None:fail(404,"not_found",f"{kind} not found")
    return out


def page(limit:int):
    if limit<1 or limit>200:fail(422,"invalid_limit","limit must be between 1 and 200")
    return limit


def publish_job(kind,payload,key):
    result=store.enqueue(kind,payload,key)
    return JSONResponse(status_code=202,content=envelope({"job_id":result["id"],**{k:v for k,v in result.items() if k.endswith("_id")}}))


def _time(s:str|None):
    if s is None:return None
    try:return datetime.fromisoformat(s)
    except ValueError:fail(422,"invalid_time","Use an ISO local source timestamp")


def interval(from_:str|None,to:str|None,default_from=None,default_to=None):
    a=from_ or default_from;b=to or default_to
    if a and b and _time(a)>=_time(b):fail(422,"invalid_interval","from must be before to")
    return a,b


def within_dataset(a:str|None,b:str|None,ds:dict):
    if a and b and ds.get("from") and ds.get("to") and (
        _time(a)<_time(ds["from"]) or _time(b)>_time(ds["to"])
    ):
        fail(422,"outside_dataset","Requested range extends outside dataset coverage")


def parquet_path(obj,key):
    manifest=obj.get("manifest",{})
    raw=manifest.get(key+"_path") or manifest.get(key)
    if not raw:fail(409,"not_ready",f"{key} artifact unavailable")
    p=Path(raw).resolve()
    if not p.is_relative_to(store.ROOT) or not p.exists():fail(409,"not_ready",f"{key} artifact unavailable")
    return p


def query_parquet(path,sql,args=None):
    con=duckdb.connect(database=":memory:")
    try:
        parquet=str(path / "*.parquet") if Path(path).is_dir() else str(path)
        con.execute("CREATE VIEW source AS SELECT * FROM read_parquet('"+parquet.replace("'","''")+"')")
        result=con.execute(sql,args or [])
        cols=[x[0] for x in result.description]
        return [dict(zip(cols,row)) for row in result.fetchall()]
    finally:con.close()


@app.get("/api/v1/health")
def health():return envelope({"api":"ready","worker":"separate_process","cache":"local"})


@app.get("/api/v1/datasets")
def datasets(cursor:str|None=None,limit:int=50):
    data,next_cursor=store.list_entities("dataset",cursor,page(limit))
    return envelope(data,next_cursor=next_cursor)


@app.post("/api/v1/datasets/uploads")
async def upload(file:UploadFile=File(...)):
    name=Path(file.filename or "").name
    if name!=(file.filename or "") or not name.lower().endswith((".csv",".txt")):fail(422,"invalid_file","Choose a CSV or TXT file")
    size=0;buffer=io.BytesIO();limit=200*1024*1024
    while chunk:=await file.read(1024*1024):
        size+=len(chunk)
        if size>limit:fail(413,"upload_too_large","File exceeds 200 MiB")
        if b"\x00" in chunk:fail(422,"invalid_file","Binary files are not accepted")
        buffer.write(chunk)
    if size==0:fail(422,"invalid_file","File is empty")
    raw=buffer.getvalue()
    try:sample=raw[:65536].decode("utf-8-sig")
    except UnicodeDecodeError:fail(422,"invalid_encoding","Use UTF-8 text")
    delimiter=";" if sample.splitlines()[0].count(";")>sample.splitlines()[0].count(",") else ","
    reader=csv.DictReader(io.StringIO(sample),delimiter=delimiter)
    columns=reader.fieldnames or []
    if len(columns)<2:fail(422,"invalid_file","At least two columns are required")
    preview=list(row for _,row in zip(range(100),reader))
    id=store.new_id("ds")
    dest=store.ROOT/"uploads"/(id+".txt");dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw)
    ds={"id":id,"version":"","label":name,"source_kind":"upload","source_hash":hashlib.sha256(raw).hexdigest(),"source_path":str(dest),"status":"needs_mapping","mapping":None,"created_at":store.now(),"from":"","to":"","capabilities":{"observations":False,"forecast":False,"evaluation":False,"circuits":False,"autoencoder":False}}
    store.put("dataset",ds)
    return envelope({"id":id,"detected_columns":columns,"preview":preview},dataset_id=id)


@app.put("/api/v1/datasets/{id}/mapping")
def mapping(id:str,body:dict):
    from .processing import validate_mapping, inspect_source
    ds=entity("dataset",id)
    if ds["status"]=="processing":fail(409,"busy","Dataset is processing")
    normalized=validate_mapping(body)
    sample=inspect_source(ds["source_path"],preview_limit=10)
    required=set(normalized["columns"])
    required.update(("Date","Time") if normalized["source_kind"]=="uci" else (normalized["timestamp_column"],))
    absent=required-set(sample["columns"])
    if absent:fail(422,"invalid_mapping","Mapped source columns are missing",{"columns":sorted(absent)})
    parsed=[];invalid=0
    for raw in sample["preview"]:
        try:
            if normalized["source_kind"]=="uci":
                stamp=datetime.strptime(raw["Date"]+" "+raw["Time"],"%d/%m/%Y %H:%M:%S")
            else:
                fmt=normalized["timestamp_format"].replace("yyyy","%Y").replace("MM","%m").replace("dd","%d").replace("HH","%H").replace("mm","%M").replace("ss","%S")
                stamp=datetime.strptime(raw[normalized["timestamp_column"]],fmt)
            power_col=next(source for source,canonical in normalized["columns"].items() if canonical=="active_power_kw")
            number=float(raw[power_col])
            if normalized["units"]["active_power_kw"]=="W":number/=1000
            parsed.append({"timestamp_local":stamp.isoformat(),"active_power_kw":number})
        except (KeyError,TypeError,ValueError):
            invalid+=1
    if not parsed:fail(422,"invalid_mapping","No preview rows could be parsed",{"invalid_rows":invalid})
    ds.update(mapping=normalized,status="ready_for_processing")
    store.put("dataset",ds)
    return envelope({"mapping":normalized,"preview":parsed,"diagnostics":[],"invalid_rows":invalid},dataset_id=id)


@app.post("/api/v1/datasets/{id}/preprocess",status_code=202)
def preprocess(id:str,body:dict,idempotency_key:str|None=Header(None)):
    ds=entity("dataset",id)
    if not ds.get("mapping"):fail(409,"needs_mapping","Validate a mapping first")
    profile=body.get("profile","development")
    if profile not in ("development","final"):fail(422,"invalid_profile","profile must be development or final")
    version="v_"+store.digest({"source_hash":ds["source_hash"],"mapping":ds["mapping"],"profile":profile,"start_date":body.get("start_date")})
    ds["status"]="processing";store.put("dataset",ds)
    return publish_job("preprocess",{"dataset_id":id,"version":version,"profile":profile,"start_date":body.get("start_date")},idempotency_key)


@app.get("/api/v1/datasets/{id}")
def dataset(id:str):
    ds=entity("dataset",id)
    return envelope({k:v for k,v in ds.items() if k not in ("source_path","mapping","manifest")},dataset_id=id,dataset_version=ds.get("version"))


@app.get("/api/v1/datasets/{id}/quality")
def quality(id:str):
    ds=entity("dataset",id)
    if ds["status"]!="ready":fail(409,"not_ready","Dataset is not processed")
    m=ds.get("manifest",{})
    raw=m.get("quality") or {}
    counts=raw.get("quality_counts",{})
    coverage=query_parquet(parquet_path(ds,"observations"),
        "SELECT sum(valid_active_minutes)::DOUBLE/nullif(sum(expected_minutes),0) AS coverage FROM source")[0]["coverage"]
    data={"selected_rows":raw.get("selected_rows"),
          "invalid_timestamps":raw.get("invalid_timestamp_rows"),
          "duplicate_rows":raw.get("duplicate_rows"),
          "complete_bins":counts.get("complete"),"partial_bins":counts.get("partial"),
          "missing_bins":counts.get("missing"),"coverage":coverage,
          "etl_seconds":m.get("timings_seconds",{}).get("total_before_publish"),
          "gaps":[{"from":g["start"],"to":g["end"],"reason":"missing_readings"}
                  for g in raw.get("gap_spans",[])]}
    return envelope(data,dataset_id=id,dataset_version=ds.get("version"))


@app.get("/api/v1/datasets/{id}/series")
def series(id:str,request:Request,channel:str="active_power_kw",max_buckets:int=2000,
           from_:str|None=Query(None,alias="from"),to:str|None=None,dataset_version:str|None=None):
    ds=entity("dataset",id)
    if dataset_version and dataset_version!=ds.get("version"):fail(409,"version_conflict","Dataset version changed")
    if max_buckets<1 or max_buckets>5000:fail(422,"invalid_buckets","max_buckets must be 1..5000")
    if channel not in ("active_power_kw","reactive_power_kvar","voltage_v","current_a","observed_energy_kwh"):fail(422,"invalid_channel","Unsupported channel")
    a,b=interval(from_,to,ds.get("from"),ds.get("to"))
    within_dataset(a,b,ds)
    path=parquet_path(ds,"observations")
    columns=query_parquet(path,"DESCRIBE source")
    names={r["column_name"] for r in columns}
    t="bin_start" if "bin_start" in names else "timestamp"
    if channel not in names:fail(422,"invalid_channel","Channel unavailable")
    where=[];args=[]
    if a:where.append(f"{t}>=?");args.append(a)
    if b:where.append(f"{t}<?");args.append(b)
    clause="WHERE "+" AND ".join(where) if where else ""
    n=query_parquet(path,f"SELECT count(*) AS n FROM source {clause}",args)[0]["n"]
    stride=max(1,(n+max_buckets-1)//max_buckets)
    channel_sql=("sum(observed_energy_kwh)" if channel=="observed_energy_kwh" else f"avg({channel})")
    energy_sql=("" if channel=="observed_energy_kwh" else ",sum(observed_energy_kwh) AS observed_energy_kwh")
    sql=f"""WITH numbered AS (SELECT *, (row_number() OVER (ORDER BY {t})-1)//{stride} AS bucket FROM source {clause})
      SELECT min({t}) AS bin_start,max(bin_end) AS bin_end,{channel_sql} AS {channel},
      min(active_power_kw) AS min_observed_power_kw,max(active_power_kw) AS max_observed_power_kw
      {energy_sql},
      sum(coalesce(valid_active_minutes,0)) AS valid_active_minutes,sum(coalesce(expected_minutes,0)) AS expected_minutes,
      count(*) AS source_row_count FROM numbered GROUP BY bucket ORDER BY bucket"""
    rows=query_parquet(path,sql,args)
    for r in rows:
        r["quality"]="complete" if r["valid_active_minutes"]==r["expected_minutes"] else "partial" if r["valid_active_minutes"] else "missing"
    return envelope(rows,dataset_id=id,dataset_version=ds.get("version"),**{"from":a,"to":b})



@app.get("/api/v1/datasets/{id}/peaks")
def peaks(id:str,request:Request,percentile:float=0.99,min_duration_minutes:int=15,
          gap_minutes:int=15,max_series_points:int=5000,
          from_:str|None=Query(None,alias="from"),to:str|None=None,
          dataset_version:str|None=None):
    ds=entity("dataset",id)
    if ds.get("status")!="ready":fail(409,"not_ready","Dataset is not processed")
    if dataset_version and dataset_version!=ds.get("version"):fail(409,"version_conflict","Dataset version changed")
    if max_series_points<100 or max_series_points>5000:fail(422,"invalid_points","max_series_points must be 100..5000")
    a,b=interval(from_,to,ds.get("from"),ds.get("to"));within_dataset(a,b,ds)
    path=parquet_path(ds,"observations")
    where=[];args=[]
    if a:where.append("bin_start>=?");args.append(a)
    if b:where.append("bin_start<?");args.append(b)
    clause="WHERE "+" AND ".join(where) if where else ""
    rows=query_parquet(path,"SELECT bin_start,bin_end,active_power_kw,observed_energy_kwh,valid_active_minutes FROM source "+clause+" ORDER BY bin_start",args)
    data=analyze_peak_rows(rows,percentile=percentile,min_duration_minutes=min_duration_minutes,
                           gap_minutes=gap_minutes,max_series_points=max_series_points)
    return envelope(data,dataset_id=id,dataset_version=ds.get("version"),**{"from":a,"to":b})

@app.get("/api/v1/datasets/{id}/profiles")
def profiles(id:str,request:Request,from_:str|None=Query(None,alias="from"),to:str|None=None,
             dataset_version:str|None=None):
    ds=entity("dataset",id);path=parquet_path(ds,"observations")
    if dataset_version and dataset_version!=ds.get("version"):fail(409,"version_conflict","Dataset version changed")
    a,b=interval(from_,to,ds.get("from"),ds.get("to"))
    within_dataset(a,b,ds)
    args=[a,b] if a and b else []
    where="WHERE bin_start>=? AND bin_start<?" if args else ""
    daily=query_parquet(path,f"SELECT cast(bin_start AS DATE)::VARCHAR AS date,sum(observed_energy_kwh) AS observed_energy_kwh,sum(valid_active_minutes)::DOUBLE/nullif(sum(expected_minutes),0) AS coverage,count(*) FILTER (WHERE quality='complete') AS valid_bins FROM source {where} GROUP BY 1 ORDER BY 1",args)
    slots=query_parquet(path,f"SELECT strftime(bin_start,'%H:%M') AS slot,median(active_power_kw) FILTER (WHERE quality='complete') AS median_kw,count(*) FILTER (WHERE quality='complete') AS count FROM source {where} GROUP BY 1 ORDER BY 1",args)
    totals=query_parquet(path,f"SELECT sum(sub1_observed_wh)/1000 AS sub1,sum(sub2_observed_wh)/1000 AS sub2,sum(sub3_observed_wh)/1000 AS sub3,sum(remainder_observed_wh)/1000 AS remainder,sum(observed_energy_kwh) AS total,sum(valid_active_minutes)::DOUBLE/nullif(sum(expected_minutes),0) AS coverage FROM source {where}",args)[0]
    circuits=[{"label":label,"energy_kwh":totals[key],"coverage":totals["coverage"]}
              for label,key in (("Sub-metering 1","sub1"),("Sub-metering 2","sub2"),("Sub-metering 3","sub3"),("Aligned remainder","remainder"))
              if totals[key] is not None]
    return envelope({"daily":daily,"slots":slots,"circuits":circuits},dataset_id=id,dataset_version=ds.get("version"),**{"from":a,"to":b})


@app.post("/api/v1/runs",status_code=202)
def create_run(body:dict,idempotency_key:str|None=Header(None)):
    ds=entity("dataset",body.get("dataset_id",""))
    if ds["status"]!="ready":fail(409,"not_ready","Dataset is not processed")
    if body.get("dataset_version")!=ds.get("version"):fail(409,"version_conflict","Dataset version changed")
    model=body.get("model_id")
    if model not in ("chronos_bolt_tiny","persistence","seasonal_naive_96"):fail(422,"invalid_model","Unsupported model")
    kind=body.get("evaluation_kind","held_out")
    if kind not in ("held_out","inference"):fail(422,"invalid_evaluation","Unsupported evaluation kind")
    config=body.get("config") or {}
    if not isinstance(config,dict) or set(config)-{"context_bins","horizons","threshold_quantile","batch_size"}:fail(422,"invalid_config","Unsupported run configuration")
    horizons=config.get("horizons",[1,4,16])
    if not isinstance(horizons,list) or not horizons or any(x not in (1,4,16) for x in horizons):fail(422,"invalid_config","Horizons must be 1, 4, or 16")
    q=config.get("threshold_quantile",0.99)
    if not isinstance(q,(int,float)) or not 0.95<=q<=0.999:fail(422,"invalid_config","Threshold quantile outside 0.95..0.999")
    run_id=("run_"+hashlib.sha256(idempotency_key.encode()).hexdigest()[:32]
            if idempotency_key else store.new_id("run"))
    existing=store.get("run",run_id)
    if existing and (existing["dataset_id"]!=ds["id"] or
                     existing["dataset_version"]!=ds["version"] or
                     existing["model_id"]!=model or existing["evaluation_kind"]!=kind or
                     existing["config_hash"]!=store.digest(config)):
        fail(409,"idempotency_conflict","This key was used for another run request")
    run={"id":run_id,"dataset_id":ds["id"],"dataset_version":ds["version"],"model_id":model,"model_revision":"a0e552de83495b5c28c14c71c374f3e33280b340" if model=="chronos_bolt_tiny" else "builtin-1","status":"queued","evaluation_kind":kind,"config":config,"config_hash":store.digest(config),"source_hash":ds["source_hash"],"created_at":store.now(),"test_from":"","test_to":"","threshold":None}
    if not existing:store.put("run",run)
    response=publish_job("evaluate" if kind=="held_out" else "register_inference",
                         {"run_id":run_id,"dataset_id":ds["id"]},idempotency_key)
    return response


@app.get("/api/v1/runs")
def runs(dataset:str|None=None,cursor:str|None=None,limit:int=50):
    rows,next_cursor=store.list_entities("run",cursor,page(limit))
    if dataset:rows=[r for r in rows if r["dataset_id"]==dataset]
    return envelope([{k:v for k,v in r.items() if k not in ("manifest","config")} for r in rows],next_cursor=next_cursor)


@app.get("/api/v1/runs/{id}")
def run(id:str):
    r=entity("run",id)
    return envelope({k:v for k,v in r.items() if k!="manifest"},dataset_id=r["dataset_id"],dataset_version=r["dataset_version"],run_id=id)


def run_table(id,key):
    r=entity("run",id)
    if r["status"]!="succeeded":fail(409,"not_ready","Run is not ready")
    return r,parquet_path(r,key)


@app.get("/api/v1/runs/{id}/metrics")
def metrics(id:str):
    r=entity("run",id)
    if r["status"]!="succeeded":fail(409,"not_ready","Run is not ready")
    m=r.get("manifest",{})
    path=m.get("metrics_path")
    data=[]
    if path and Path(path).exists():
        raw=json.loads(Path(path).read_text(encoding="utf-8"))
        data=[{"model_id":r["model_id"],"horizon":int(key.split("_h")[-1]),
               "split":key.split("_h")[0],"mae_kw":value.get("mae_kw"),
               "rmse_kw":value.get("rmse_kw"),"mase":value.get("mase"),
               "coverage_q10_q90":value.get("q10_q90_coverage"),
               "count":value.get("target_bins",0),"skipped":m.get("skip_reasons",{}).get("missing_target",0)}
              for key,value in raw.items() if "_h" in key and isinstance(value,dict)]
    return envelope(data,dataset_id=r["dataset_id"],dataset_version=r["dataset_version"],run_id=id)


@app.get("/api/v1/runs/{id}/forecasts")
def forecasts(id:str,request:Request,horizon:int=1,model:str|None=None,origin:str|None=None):
    r=entity("run",id)
    if r["status"]!="succeeded":fail(409,"not_ready","Run is not ready")
    if horizon not in (1,4,16):fail(422,"invalid_horizon","Horizon must be 1, 4, or 16")
    manifest=r.get("manifest") or {}
    use_latest=(manifest.get("latest_forecast_horizon")==horizon and
                (not origin or origin==manifest.get("latest_forecast_origin")) and
                (not model or model==r["model_id"]))
    path=manifest.get("latest_forecast_path") if use_latest else manifest.get("forecasts_path")
    if not path:
        return envelope([],dataset_id=r["dataset_id"],dataset_version=r["dataset_version"],run_id=id)
    path=parquet_path({"manifest":{"forecasts_path":path}},"forecasts")
    where=["horizon=?"];args=[horizon]
    if model:where.append("model_id=?");args.append(model)
    if origin:where.append("origin=?");args.append(origin)
    rows=query_parquet(path,"SELECT * FROM source WHERE "+" AND ".join(where)+" ORDER BY origin DESC,step LIMIT 5000",args)
    return envelope(rows,dataset_id=r["dataset_id"],dataset_version=r["dataset_version"],run_id=id)


@app.get("/api/v1/runs/{id}/scores")
def scores(id:str,request:Request,detector:str|None=None,
           from_:str|None=Query(None,alias="from"),to:str|None=None):
    r,path=run_table(id,"scores")
    a,b=interval(from_,to,r.get("test_from"),r.get("test_to"))
    where=[];args=[]
    if a:where.append("bin_start>=?");args.append(a)
    if b:where.append("bin_start<?");args.append(b)
    if detector:where.append("detector=?");args.append(detector)
    clause="WHERE "+" AND ".join(where) if where else ""
    rows=query_parquet(path,f"SELECT * FROM source {clause} ORDER BY bin_start LIMIT 5000",args)
    return envelope(rows,dataset_id=r["dataset_id"],dataset_version=r["dataset_version"],run_id=id,**{"from":a,"to":b})


@app.get("/api/v1/runs/{id}/events")
def events(id:str,request:Request,detector:str|None=None,direction:str|None=None,review:str|None=None,sort:str="start",cursor:str|None=None,limit:int=50,min_peak_score:float|None=None,
           from_:str|None=Query(None,alias="from"),to:str|None=None):
    r,path=run_table(id,"events")
    if sort not in ("start","peak_score","duration_minutes"):fail(422,"invalid_sort","Unsupported sort")
    a,b=interval(from_,to,r.get("test_from"),r.get("test_to"))
    where=[];args=[]
    if a:where.append('"end">?');args.append(a)
    if b:where.append('"start"<?');args.append(b)
    if detector:where.append("detector=?");args.append(detector)
    if direction:where.append("direction=?");args.append(direction)
    if min_peak_score is not None:where.append("peak_score>=?");args.append(min_peak_score)
    clause="WHERE "+" AND ".join(where) if where else ""
    rows=query_parquet(path,f'SELECT * FROM source {clause} ORDER BY "start",id LIMIT 10000',args)
    for row in rows:
        row["review"]=store.get("review",row["id"]) or {"status":"unreviewed","note":"","revision":0}
        row["dataset_id"]=r["dataset_id"]
        row["visible_start"]=max(str(row.get("start","")),a or "")
        row["visible_end"]=min(str(row.get("end","")),b or "9999")
    if review:rows=[x for x in rows if x["review"]["status"]==review]
    if sort!="start":rows.sort(key=lambda x:(x.get(sort) or 0,x["id"]),reverse=True)
    if cursor:rows=[x for x in rows if x["id"]>cursor]
    more=len(rows)>page(limit);rows=rows[:limit]
    return envelope(rows,dataset_id=r["dataset_id"],dataset_version=r["dataset_version"],run_id=id,next_cursor=rows[-1]["id"] if more else None,**{"from":a,"to":b})



@app.get("/api/v1/runs/{id}/recommendations")
def recommendations(id:str,request:Request,
                    from_:str|None=Query(None,alias="from"),to:str|None=None,
                    percentile:float=0.99,min_duration_minutes:int=15,gap_minutes:int=15):
    r=entity("run",id);ds=entity("dataset",r["dataset_id"])
    if r.get("status")!="succeeded":fail(409,"not_ready","Run is not ready")
    a,b=interval(from_,to,r.get("test_from") or ds.get("from"),r.get("test_to") or ds.get("to"));within_dataset(a,b,ds)
    observation_path=parquet_path(ds,"observations")
    where=[];args=[]
    if a:where.append("bin_start>=?");args.append(a)
    if b:where.append("bin_start<?");args.append(b)
    clause="WHERE "+" AND ".join(where) if where else ""
    rows=query_parquet(observation_path,"SELECT bin_start,bin_end,active_power_kw,observed_energy_kwh,valid_active_minutes FROM source "+clause+" ORDER BY bin_start",args)
    peak_data=analyze_peak_rows(rows,percentile=percentile,min_duration_minutes=min_duration_minutes,gap_minutes=gap_minutes)
    event_rows=query_parquet(parquet_path(r,"events"),
        'SELECT peak_score FROM source WHERE detector=\'residual\' AND "end">? AND start<?',[a,b]) if a and b else []
    anomaly_peak=max((float(row["peak_score"]) for row in event_rows if row.get("peak_score") is not None),default=None)
    data=build_recommendations(peak_data,anomaly_event_count=len(event_rows),anomaly_peak_score=anomaly_peak)
    return envelope({"recommendations":data,"peak_summary":{k:peak_data.get(k) for k in ("threshold_kw","coverage","peak_count","peak_kw","excess_over_median_kwh")}},dataset_id=ds["id"],dataset_version=ds.get("version"),run_id=id,**{"from":a,"to":b})

@app.get("/api/v1/events/{id}")
def event(id:str):
    reviews=store.get("event",id)
    if reviews is None:
        runs,_=store.list_entities("run",limit=200)
        for r in runs:
            if r["status"]!="succeeded":continue
            try:rows=query_parquet(parquet_path(r,"events"),"SELECT * FROM source WHERE id=?",[id])
            except HTTPException:continue
            if rows:
                reviews=rows[0];reviews["run_id"]=r["id"];reviews["dataset_id"]=r["dataset_id"]
                break
    if reviews is None:fail(404,"not_found","Event not found")
    reviews["review"]=store.get("review",id) or {"status":"unreviewed","note":"","revision":0}
    return envelope(reviews,run_id=reviews.get("run_id"),dataset_id=reviews.get("dataset_id"))


@app.patch("/api/v1/events/{id}/review")
def review_event(id:str,body:dict):
    event(id)
    status=body.get("status")
    note=body.get("note","")
    expected=body.get("expected_revision")
    if status not in ("unreviewed","reviewed","needs_followup") or not isinstance(note,str) or len(note)>2000:fail(422,"invalid_review","Invalid review status or note")
    old=store.get("review",id) or {"revision":0}
    if expected!=old["revision"]:fail(409,"revision_conflict","Review changed; reload before saving",{"current_review":old})
    out={"id":id,"status":status,"note":note,"revision":expected+1,"updated_at":store.now()}
    store.put("review",out)
    return envelope({k:v for k,v in out.items() if k!="id"})


@app.get("/api/v1/runs/{id}/overview")
def overview(id:str,request:Request,from_:str|None=Query(None,alias="from"),to:str|None=None,
             scope:str="all"):
    r=entity("run",id);ds=entity("dataset",r["dataset_id"])
    if scope not in ("all","overnight"):fail(422,"invalid_scope","Scope must be all or overnight")
    a,b=interval(from_,to,r.get("test_from") or ds.get("from"),r.get("test_to") or ds.get("to"))
    within_dataset(a,b,ds)
    where="bin_start>=? AND bin_start<?"
    scoped_where=where+(" AND extract(hour from bin_start)<5" if scope=="overnight" else "")
    path=parquet_path(ds,"observations")
    rows=query_parquet(path,"SELECT sum(observed_energy_kwh) AS observed_energy_kwh,sum(valid_active_minutes)::DOUBLE/nullif(sum(expected_minutes),0) AS coverage,count(*) AS expected_bins FROM source WHERE "+scoped_where,[a,b])
    overnight=query_parquet(path,"SELECT sum(observed_energy_kwh) AS energy FROM source WHERE "+where+" AND extract(hour from bin_start)<5",[a,b])[0]["energy"]
    data=rows[0];data.update(overnight_observed_energy_kwh=overnight,candidate_count=0,eligible_scored_bins=0,estimated_above_reference_kwh=None)
    if r["status"]=="succeeded" and r["evaluation_kind"]=="held_out":
        sc=query_parquet(parquet_path(r,"scores"),"SELECT count(*) FILTER (WHERE status='scored') AS eligible_scored_bins,sum(estimated_above_reference_kwh) FILTER (WHERE candidate) AS estimated_above_reference_kwh FROM source WHERE detector='residual' AND "+scoped_where,[a,b])[0]
        data.update(sc)
        event_where='"end">? AND "start"<? AND detector=\'residual\''
        if scope=="overnight":event_where+=' AND extract(hour from "start")<5'
        data["candidate_count"]=query_parquet(parquet_path(r,"events"),
            "SELECT count(*) AS n FROM source WHERE "+event_where,[a,b])[0]["n"]
    return envelope(data,dataset_id=ds["id"],dataset_version=ds["version"],run_id=id,**{"from":a,"to":b})


@app.get("/api/v1/jobs")
def jobs(cursor:str|None=None,status:str|None=None,limit:int=50):
    rows,next_cursor=store.list_jobs(cursor,status,page(limit))
    return envelope(rows,next_cursor=next_cursor)


@app.get("/api/v1/jobs/{id}")
def job(id:str):return envelope(store.get_job(id) or fail(404,"not_found","Job not found"))


@app.post("/api/v1/jobs/{id}/cancel")
def cancel(id:str):return envelope(store.cancel(id) or fail(404,"not_found","Job not found"))


@app.post("/api/v1/jobs/{id}/retry")
def retry(id:str):return envelope(store.retry(id) or fail(404,"not_found","Job not found"))


@app.post("/api/v1/exports",status_code=202)
def export(body:dict,idempotency_key:str|None=Header(None)):
    kind=body.get("kind")
    if kind not in ("observations","forecasts","scores","events"):fail(422,"invalid_export","Unsupported export kind")
    if kind=="observations":entity("dataset",body.get("dataset_id",""))
    else:entity("run",body.get("run_id",""))
    return publish_job("export",{"export_kind":kind,"dataset_id":body.get("dataset_id"),"run_id":body.get("run_id"),"filters":body.get("filters") or {}},idempotency_key)


@app.get("/api/v1/artifacts/{id}/download")
def download(id:str):
    artifact=entity("artifact",id)
    path=Path(artifact["path"]).resolve()
    if not path.is_relative_to(store.ROOT/"artifacts") or not path.is_file():fail(404,"not_found","Artifact unavailable")
    if hashlib.sha256(path.read_bytes()).hexdigest()!=artifact["sha256"]:fail(409,"corrupt_artifact","Artifact checksum mismatch")
    return FileResponse(path,media_type=artifact["mime"],filename=path.name)


@app.get("/api/v1/artifacts/{id}/preview")
def preview_artifact(id:str):
    artifact=entity("artifact",id)
    if artifact["mime"]!="application/pdf":fail(415,"not_previewable","Only PDF reports can be previewed")
    path=Path(artifact["path"]).resolve()
    if not path.is_relative_to(store.ROOT/"artifacts") or not path.is_file():
        fail(404,"not_found","Artifact unavailable")
    if hashlib.sha256(path.read_bytes()).hexdigest()!=artifact["sha256"]:
        fail(409,"corrupt_artifact","Artifact checksum mismatch")
    return FileResponse(path,media_type="application/pdf",filename=path.name,content_disposition_type="inline",
                        headers={"X-Content-Type-Options":"nosniff"})


@app.post("/api/v1/reports",status_code=202)
def create_report(body:dict,idempotency_key:str|None=Header(None)):
    r=entity("run",body.get("run_id",""))
    if r["status"]!="succeeded":fail(409,"not_ready","Run is not ready")
    a,b=interval(body.get("from"),body.get("to"),r.get("test_from"),r.get("test_to"))
    sections=body.get("sections",[])
    allowed_sections={"consumption","forecasting","events","notes","quality","methodology",
                      "overview","forecast","anomalies","metrics","method"}
    if not isinstance(sections,list) or any(s not in allowed_sections for s in sections):
        fail(422,"invalid_sections","Unsupported report section")
    if body.get("format","pdf")!="pdf":fail(422,"invalid_format","Only PDF reports are supported")
    event_ids=body.get("event_ids") or []
    if not isinstance(event_ids,list) or len(event_ids)>10000 or any(not isinstance(v,str) for v in event_ids):
        fail(422,"invalid_event_ids","Invalid event selection")
    detector=body.get("detector","chronos_residual")
    detector_value={"chronos_residual":"residual","statistical":"slot_mad",
                    "residual":"residual","slot_mad":"slot_mad"}.get(detector)
    if detector_value is None:fail(422,"invalid_detector","Unsupported report detector")
    notes_snapshot=[]
    if "notes" in sections:
        path=r.get("manifest",{}).get("events_path")
        if path:
            matching=query_parquet(Path(path),
                'SELECT id FROM source WHERE "end">? AND "start"<? AND detector=? ORDER BY "start",id LIMIT 10000',[a,b,detector_value])
            wanted=set(event_ids) if event_ids else None
            for event_row in matching:
                if wanted is not None and event_row["id"] not in wanted:continue
                review=store.get("review",event_row["id"])
                if review and review.get("note"):
                    notes_snapshot.append({"event_id":event_row["id"],"status":review["status"],
                                           "note":review["note"],"revision":review["revision"]})
    report_id=("report_"+hashlib.sha256(idempotency_key.encode()).hexdigest()[:32]
               if idempotency_key else store.new_id("report"))
    existing=store.get("report",report_id)
    if existing and (existing["run_id"]!=r["id"] or existing["from"]!=a or
                     existing["to"]!=b or existing["sections"]!=sections or
                     existing.get("event_ids",[])!=event_ids or
                     existing.get("scope")!=body.get("scope","all") or
                     existing.get("detector","chronos_residual")!=detector):
        fail(409,"idempotency_conflict","This key was used for another report request")
    report={"id":report_id,"run_id":r["id"],"status":"queued","from":a,"to":b,
            "sections":sections,"scope":body.get("scope","all"),"event_ids":event_ids,
            "detector":detector,
            "forecast_origin":body.get("forecast_origin"),"forecast_horizon":body.get("forecast_horizon"),
            "forecast_model":body.get("forecast_model"),"notes_snapshot":notes_snapshot,
            "artifact_ids":[],"renderer":"reportlab-print-v2","created_at":store.now()}
    if not existing:store.put("report",report)
    return publish_job("report",{"run_id":r["id"],"report_id":report_id},idempotency_key)


@app.get("/api/v1/reports/{id}")
def report(id:str):
    r=entity("report",id)
    return envelope(r,run_id=r["run_id"],**{"from":r["from"],"to":r["to"]})


@app.post("/api/v1/runs/{id}/forecasts",status_code=202)
def create_forecast(id:str,body:dict,idempotency_key:str|None=Header(None)):
    r=entity("run",id)
    if r["status"]!="succeeded":fail(409,"not_ready","Run is not ready")
    horizon=body.get("horizon",1)
    if horizon not in (1,4,16):fail(422,"invalid_horizon","Horizon must be 1, 4, or 16")
    if body.get("model_id",r["model_id"])!=r["model_id"]:fail(422,"invalid_model","Use the run's registered model")
    mode=body.get("origin_mode","dataset_endpoint")
    if mode not in ("dataset_endpoint","historical"):fail(422,"invalid_origin_mode","Unsupported forecast mode")
    if mode=="historical" and not body.get("origin"):fail(422,"invalid_origin","Historical mode requires an origin")
    return publish_job("forecast",{"run_id":id,"horizon":horizon,"origin_mode":mode,
                                   "origin":body.get("origin")},idempotency_key)


@app.post("/api/v1/runs/{id}/threshold-previews",status_code=202)
def threshold_preview(id:str,body:dict,idempotency_key:str|None=Header(None)):
    run=entity("run",id)
    if run["status"]!="succeeded" or run["evaluation_kind"]!="held_out":
        fail(409,"not_ready","Held-out results are required for a threshold preview")
    q=body.get("validation_quantile",body.get("quantile",body.get("threshold_quantile")))
    if not isinstance(q,(float,int)) or not 0.95<=q<=0.999:fail(422,"invalid_quantile","Quantile must be 0.95..0.999")
    return publish_job("threshold_preview",{"run_id":id,"quantile":q},idempotency_key)


@app.post("/api/v1/experiments")
def experiments():fail(422,"unsupported_experiment","Optional experiments are not installed")


@app.post("/api/v1/bundles/import")
def import_bundle():fail(422,"unsupported_bundle","Bundle import is unavailable")
