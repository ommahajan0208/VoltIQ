import datetime as dt, math, json, pathlib
start=dt.datetime(2007,5,1)
fmt=lambda t:t.isoformat()
bins=[]; scores=[]
# A deterministic illustration, NOT UCI data or Chronos output.
event_intervals=[(108,112,'higher'),(302,304,'lower'),(589,594,'higher')]
for i in range(672):
    time=start+dt.timedelta(minutes=15*i); slot=i%96
    base=.35+.13*math.sin(i*.17)+(.65 if 28<=slot<=35 else 0)+(.9 if 68<=slot<=81 else 0)
    value=max(.15,base+.13*math.sin(i*.73))
    for lo,hi,direction in event_intervals:
        if lo<=i<hi:value=value+1.35 if direction=='higher' else .02
    quality='missing' if 210<=i<214 else ('partial' if i in [84,402] else 'complete')
    val=None if quality=='missing' else round(value,3)
    valid=0 if quality=='missing' else 12 if quality=='partial' else 15
    bins.append(dict(bin_start=fmt(time),bin_end=fmt(time+dt.timedelta(minutes=15)),active_power_kw=val,reactive_power_kvar=round(value*.13,3) if val else None,voltage_v=round(238+2*math.sin(i*.14),2) if val else None,current_a=round(value*4.2,2) if val else None,observed_energy_kwh=round(value*valid/60,5) if val else None,quality=quality,valid_active_minutes=valid,expected_minutes=15))
    eligible=quality=='complete'
    score=round(abs(value-base),3) if eligible else None
    scores.append(dict(bin_start=fmt(time),score=score,score_unit='kW',predicted_kw=round(base,3),baseline_kw=round(base*.93,3),threshold=.28,status='scored' if eligible else 'quality_excluded',candidate=score>.28 if eligible else None))
events=[]
for j,(lo,hi,direction) in enumerate(event_intervals):
    events.append(dict(id=f'demo_event_{j+1}',run_id='demo_run',dataset_id='demo_household',detector='chronos_residual',start=bins[lo]['bin_start'],end=bins[hi-1]['bin_end'],duration_minutes=(hi-lo)*15,peak_score=max(s['score'] for s in scores[lo:hi]),score_unit='kW',direction=direction,estimated_above_reference_kwh=round(sum(max(0,b['active_power_kw']-s['baseline_kw'])*.25 for b,s in zip(bins[lo:hi],scores[lo:hi])),3),review=dict(status='unreviewed',note='',revision=0)))
daily=[]
for d in range(7):
    part=bins[d*96:(d+1)*96]
    daily.append(dict(date=part[0]['bin_start'][:10],observed_energy_kwh=round(sum(b['observed_energy_kwh'] or 0 for b in part),3),coverage=sum(b['valid_active_minutes'] for b in part)/1440,valid_bins=sum(b['quality']=='complete' for b in part)))
slots=[]
for j in range(96):
    vals=sorted(bins[i]['active_power_kw'] for i in range(j,672,96) if bins[i]['active_power_kw'] is not None)
    slots.append(dict(slot=f'{j//4:02}:{j%4*15:02}',median_kw=vals[len(vals)//2] if vals else None,count=len(vals)))
forecasts={}
for i in [196,388,580,672]:
    origin=fmt(start+dt.timedelta(minutes=i*15)); rows=[]
    last=bins[i-1]['active_power_kw'] or .35
    for step in range(1,17):
        k=i+step-1; slot=k%96; pred=max(.15,.35+.13*math.sin(k*.17)+(.65 if 28<=slot<=35 else 0)+(.9 if 68<=slot<=81 else 0))
        b=bins[k] if k<672 else None
        rows.append(dict(origin=origin,target_start=fmt(start+dt.timedelta(minutes=k*15)),target_end=fmt(start+dt.timedelta(minutes=(k+1)*15)),step=step,horizon=16,q10_kw=round(max(0,pred-.18),3),q50_kw=round(pred,3),q90_kw=round(pred+.18,3),actual_kw=b['active_power_kw'] if b and b['quality']=='complete' else None,target_eligible=bool(b and b['quality']=='complete'),persistence_kw=last,seasonal_naive_kw=bins[k-96]['active_power_kw'] if 0<=k-96<672 else None))
    forecasts[origin]=rows
fixture=dict(dataset=dict(id='demo_household',version='synthetic_v1',label='Illustrative household',source_kind='synthetic',status='ready',**{'from':fmt(start),'to':fmt(start+dt.timedelta(days=7))},capabilities=dict(observations=True,forecast=True,evaluation=True,circuits=True,autoencoder=False)),run=dict(id='demo_run',dataset_id='demo_household',dataset_version='synthetic_v1',model_id='synthetic_forecast',model_revision='illustration-only',status='succeeded',evaluation_kind='synthetic_demonstration',test_from=fmt(start),test_to=fmt(start+dt.timedelta(days=7)),threshold=.28,config_hash='synthetic-config-v1',source_hash='synthetic-not-uci'),bins=bins,scores=scores,events=events,profiles=dict(daily=daily,slots=slots,circuits=[dict(label='Kitchen circuit',energy_kwh=12.8,coverage=1),dict(label='Laundry circuit',energy_kwh=8.2,coverage=1),dict(label='Heating / cooling circuit',energy_kwh=34.5,coverage=1)]),quality=dict(selected_rows=10080,invalid_timestamps=0,duplicate_rows=0,complete_bins=666,partial_bins=2,missing_bins=4,coverage=sum(b['valid_active_minutes'] for b in bins)/10080,etl_seconds=None,gaps=[{'from':bins[210]['bin_start'],'to':bins[213]['bin_end'],'reason':'Illustrative missing observations'}]),forecasts=forecasts)
pathlib.Path('src/fixtures/synthetic.json').write_text(json.dumps(fixture,separators=(',',':')))
