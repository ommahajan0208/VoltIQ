"""Run separately from the API: python -m app.worker."""
from __future__ import annotations

import argparse
import json
import time
import traceback
from pathlib import Path

from . import store


def _publish(tmp: Path, final: Path):
    if final.exists(): raise RuntimeError("Result directory already exists")
    final.parent.mkdir(parents=True,exist_ok=True)
    tmp.replace(final)


def execute(job: dict, payload: dict) -> dict:
    job_id=job["id"]
    kind=job["kind"]
    store.update_job(job_id,stage="preparing")
    if kind=="register_inference":
        run=store.get("run",payload["run_id"])
        if not run:raise ValueError("Run missing")
        run.update(status="succeeded",completed_at=store.now(),manifest={})
        store.put("run",run)
        return {"run_id":run["id"]}
    if kind=="preprocess":
        from .processing import process_dataset
        ds=store.get("dataset",payload["dataset_id"])
        if not ds: raise ValueError("Dataset missing")
        version=payload["version"]
        final=store.ROOT/"datasets"/ds["id"]/version
        tmp=store.ROOT/"tmp"/job_id
        tmp.mkdir(parents=True,exist_ok=True)
        store.update_job(job_id,stage="spark_preprocessing")
        manifest=process_dataset(ds["source_path"],tmp,ds["id"],ds["mapping"],payload["profile"],payload.get("start_date"))
        if store.get_job(job_id)["cancel_requested"]: raise InterruptedError("Cancelled")
        (tmp/"manifest.json").write_text(json.dumps(manifest,indent=2,default=str),encoding="utf-8")
        _publish(tmp,final)
        manifest["root"]=str(final)
        for k,v in list(manifest.items()):
            if k.endswith("_path") and isinstance(v,str):
                p=Path(v)
                if p.is_relative_to(tmp): manifest[k]=str(final/p.relative_to(tmp))
        (final/"manifest.json").write_text(json.dumps(manifest,indent=2,default=str),encoding="utf-8")
        first=manifest["from"];last=manifest["to"]
        from datetime import datetime
        enough_history=(datetime.fromisoformat(last)-datetime.fromisoformat(first)).days>=28
        capabilities={"observations":True,"forecast":manifest["aggregate_rows"]>=193,
                      "evaluation":enough_history,"circuits":manifest["capabilities"]["submetering"],
                      "autoencoder":False}
        store.put("dataset_version",{"id":version,"dataset_id":ds["id"],"manifest":manifest,
                                     "from":first,"to":last,"capabilities":capabilities})
        ds.update(status="ready",version=version,manifest=manifest,
                  source_kind=manifest["source_kind"],
                  **{"from":first,"to":last},capabilities=capabilities)
        store.put("dataset",ds)
        return {"dataset_id":ds["id"],"dataset_version":version}
    if kind=="evaluate":
        from .models import evaluate
        run=store.get("run",payload["run_id"])
        ds=store.get("dataset",run["dataset_id"])
        tmp=store.ROOT/"tmp"/job_id; tmp.mkdir(parents=True,exist_ok=True)
        final=store.ROOT/"runs"/run["id"]
        store.update_job(job_id,stage="model_evaluation")
        manifest=evaluate(ds["manifest"],run["model_id"],
                          {**run["config"],"run_id":run["id"],"evaluation_kind":run["evaluation_kind"]},tmp)
        if store.get_job(job_id)["cancel_requested"]: raise InterruptedError("Cancelled")
        _publish(tmp,final)
        for k,v in list(manifest.items()):
            if (k.endswith("_path") or k=="split_manifest") and isinstance(v,str):
                p=Path(v)
                if p.is_relative_to(tmp):manifest[k]=str(final/p.relative_to(tmp))
        (final/"run_manifest.json").write_text(json.dumps(manifest,indent=2,default=str),encoding="utf-8")
        splits=json.loads(Path(manifest["split_manifest"]).read_text(encoding="utf-8"))
        thresholds=json.loads(Path(manifest["thresholds_path"]).read_text(encoding="utf-8"))
        run.update(status="succeeded",manifest=manifest,completed_at=store.now(),
                   model_revision=manifest["model_revision"],test_from=splits["test"]["start"],
                   test_to=splits["test"]["end"],threshold=thresholds["residual"]["value"])
        store.put("run",run)
        return {"run_id":run["id"]}
    if kind=="forecast":
        from hashlib import sha256
        import pandas as pd
        from .models import infer_one
        run=store.get("run",payload["run_id"])
        if not run or run["status"]!="succeeded":raise ValueError("Run is not ready")
        ds=store.get("dataset",run["dataset_id"])
        if not ds:raise ValueError("Dataset missing")
        store.update_job(job_id,stage="forecasting")
        rows,revision=infer_one(ds["manifest"],run["model_id"],run["id"],
                                payload["origin_mode"],payload.get("origin"),payload["horizon"])
        if store.get_job(job_id)["cancel_requested"]:raise InterruptedError("Cancelled")
        directory=store.ROOT/"forecasts";directory.mkdir(parents=True,exist_ok=True)
        destination=directory/(job_id+".parquet")
        temporary=directory/(job_id+".tmp.parquet")
        pd.DataFrame(rows).to_parquet(temporary,index=False)
        temporary.replace(destination)
        artifact_id=store.new_id("art")
        store.put("artifact",{"id":artifact_id,"owner_id":run["id"],"path":str(destination),
                              "mime":"application/vnd.apache.parquet", "sha256":sha256(destination.read_bytes()).hexdigest(),
                              "size":destination.stat().st_size,"row_count":len(rows)})
        manifest=run.get("manifest") or {}
        manifest.update(latest_forecast_path=str(destination),latest_forecast_origin=rows[0]["origin"],
                        latest_forecast_horizon=payload["horizon"])
        run.update(manifest=manifest,model_revision=revision)
        store.put("run",run)
        return {"run_id":run["id"],"artifact_id":artifact_id,"row_count":len(rows)}
    if kind=="threshold_preview":
        from hashlib import sha256
        import numpy as np
        import pandas as pd
        run=store.get("run",payload["run_id"])
        if not run or run["status"]!="succeeded":raise ValueError("Run is not ready")
        scores=pd.read_parquet(run["manifest"]["scores_path"])
        residual=scores[scores["detector"]=="residual"]
        validation=residual[(residual["split"]=="validation") & residual["score"].notna()]
        if len(validation)<200:raise ValueError("At least 200 eligible validation scores are required")
        threshold=float(np.quantile(validation["score"].to_numpy(),payload["quantile"],method="linear"))
        test=residual[(residual["split"]=="test") & residual["score"].notna()]
        preview={"run_id":run["id"],"evaluation_kind":"exploratory_preview",
                 "validation_quantile":payload["quantile"],"threshold_kw":threshold,
                 "validation_count":len(validation),"eligible_test_bins":len(test),
                 "candidate_bin_count":int((test["score"]>threshold).sum()),
                 "source_threshold_kw":run.get("threshold")}
        artifact_id=store.new_id("art")
        path=store.ROOT/"artifacts"/(artifact_id+".json")
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(preview,indent=2),encoding="utf-8")
        store.put("artifact",{"id":artifact_id,"owner_id":run["id"],"path":str(path),
                              "mime":"application/json","sha256":sha256(path.read_bytes()).hexdigest(),
                              "size":path.stat().st_size})
        return {"run_id":run["id"],"artifact_id":artifact_id,
                "candidate_bin_count":preview["candidate_bin_count"]}
    if kind=="export":
        import csv
        import duckdb
        from hashlib import sha256
        kind_name=payload["export_kind"]
        owner=(store.get("dataset",payload["dataset_id"]) if kind_name=="observations"
               else store.get("run",payload.get("run_id")))
        path=_artifact_table(owner,kind_name)
        if not path: raise ValueError("Source artifact unavailable")
        artifact_id=store.new_id("art")
        dest=store.ROOT/"artifacts"/(artifact_id+".csv")
        dest.parent.mkdir(parents=True,exist_ok=True)
        store.update_job(job_id,stage="exporting")
        con=duckdb.connect()
        try:
            filters=payload.get("filters") or {}
            column={"observations":"bin_start","forecasts":"target_start",
                    "scores":"bin_start","events":"start"}[kind_name]
            source=str(Path(path)/"*.parquet") if Path(path).is_dir() else str(path)
            conditions=[];arguments=[source]
            if filters.get("from"):
                conditions.append('"end">?' if kind_name=="events" else column+">=?")
                arguments.append(filters["from"])
            if filters.get("to"):
                conditions.append(column+"<?")
                arguments.append(filters["to"])
            if filters.get("scope")=="overnight":
                conditions.append(f"extract(hour from {column}) < 5")
            for key in ("detector","direction","origin","horizon","model"):
                value=filters.get(key)
                if value in (None,"","all"):continue
                field={"detector":"detector","direction":"direction","origin":"origin",
                       "horizon":"horizon","model":"model_id"}[key]
                if (key in ("detector","direction") and kind_name not in ("scores","events")) or (
                    key in ("origin","horizon","model") and kind_name!="forecasts"):
                    continue
                conditions.append(field+"=?");arguments.append(value)
            statement="SELECT * FROM read_parquet(?)"
            if conditions:statement+=" WHERE "+" AND ".join(conditions)
            rows=con.execute(statement,arguments)
            cols=[c[0] for c in rows.description]
            output_cols=cols+(["review_status","review_note"] if kind_name=="events" else [])
            count=0
            with dest.open("w",newline="",encoding="utf-8") as f:
                w=csv.writer(f);w.writerow(output_cols)
                while batch:=rows.fetchmany(4096):
                    for row in batch:
                        values=list(row)
                        if kind_name=="events":
                            review=store.get("review",str(values[cols.index("id")])) or {}
                            status=review.get("status","unreviewed")
                            if filters.get("review") not in (None,"","all",status):continue
                            values.extend((status,review.get("note","")))
                        w.writerow([("'"+v if v and v[0] in "=+@-\t\r" else v)
                                    if isinstance(v,str) else v for v in values]);count+=1
                    if store.get_job(job_id)["cancel_requested"]:raise InterruptedError("Cancelled")
        finally:con.close()
        artifact={"id":artifact_id,"owner_id":owner["id"],"path":str(dest),"mime":"text/csv","sha256":sha256(dest.read_bytes()).hexdigest(),"size":dest.stat().st_size,"row_count":count}
        store.put("artifact",artifact)
        return {"artifact_id":artifact_id,"row_count":count}
    if kind=="report":
        from hashlib import sha256
        from .reporting import render_report_pdf
        report=store.get("report",payload["report_id"])
        run=store.get("run",payload["run_id"])
        ds=store.get("dataset",run["dataset_id"]) if run else None
        if not report or not run or not ds:raise ValueError("Report inputs unavailable")
        artifact_id=store.new_id("art")
        dest=store.ROOT/"artifacts"/(artifact_id+".pdf")
        store.update_job(job_id,stage="rendering_report")
        render_report_pdf(report,run,ds,dest)
        artifact={"id":artifact_id,"owner_id":report["id"],"path":str(dest),
                  "mime":"application/pdf","sha256":sha256(dest.read_bytes()).hexdigest(),
                  "size":dest.stat().st_size}
        store.put("artifact",artifact)
        report.update(status="succeeded",artifact_ids=[artifact_id])
        store.put("report",report)
        return {"report_id":report["id"],"artifact_id":artifact_id}
    raise ValueError(f"Unsupported job kind: {kind}")


def _artifact_table(owner:dict,kind:str):
    key={"observations":"observations_path","forecasts":"forecasts_path","scores":"scores_path","events":"events_path"}.get(kind)
    if not key:return None
    manifest=owner.get("manifest",{})
    return manifest.get(key) or manifest.get(kind)


def run_once() -> bool:
    claimed=store.claim()
    if not claimed:return False
    job,payload=claimed
    try:
        result=execute(job,payload)
        store.update_job(job["id"],status="succeeded",stage="complete",result=result,finished_at=store.now())
    except InterruptedError:
        store.update_job(job["id"],status="cancelled",stage="cancelled",finished_at=store.now())
    except Exception as exc:
        # Diagnostic traceback is local to worker stderr; UI receives a bounded message.
        traceback.print_exc()
        store.update_job(job["id"],status="failed",stage="failed",error=str(exc)[:500],finished_at=store.now())
    return True


def main():
    parser=argparse.ArgumentParser();parser.add_argument("--once",action="store_true")
    args=parser.parse_args()
    store.init();store.interrupt_stale()
    if args.once:run_once();return
    while True:
        if not run_once():time.sleep(2)


if __name__=="__main__": main()
