import json,pathlib
routes={
'/health':['get'], '/datasets':['get'], '/datasets/uploads':['post'], '/datasets/{id}':['get'], '/datasets/{id}/mapping':['put'], '/datasets/{id}/preprocess':['post'], '/datasets/{id}/quality':['get'], '/datasets/{id}/series':['get'], '/datasets/{id}/profiles':['get'], '/runs':['get','post'], '/runs/{id}':['get'], '/runs/{id}/overview':['get'], '/runs/{id}/scores':['get'], '/runs/{id}/events':['get'], '/runs/{id}/forecasts':['get','post'], '/runs/{id}/metrics':['get'], '/runs/{id}/threshold-previews':['post'], '/events/{id}':['get'], '/events/{id}/review':['patch'], '/jobs':['get'], '/jobs/{id}':['get'], '/jobs/{id}/cancel':['post'], '/reports':['post'], '/reports/{id}':['get'], '/exports':['post'], '/experiments':['post'], '/bundles/import':['post']}
paths={}
for path,methods in routes.items():
    paths[path]={}
    for method in methods:
        op={'operationId':method+'_'+path.replace('/','_').replace('{','').replace('}',''),'responses':{'200':{'description':'Frontend expected envelope. Provisional until FastAPI publishes OpenAPI.','content':{'application/json':{'schema':{'$ref':'#/components/schemas/Envelope'}}}},'202':{'description':'Accepted job','content':{'application/json':{'schema':{'$ref':'#/components/schemas/Envelope'}}}},'default':{'description':'Error','content':{'application/json':{'schema':{'$ref':'#/components/schemas/Error'}}}}}}
        params=[]
        if '{id}' in path:params.append({'name':'id','in':'path','required':True,'schema':{'type':'string'}})
        if method=='get':
            for name in ['dataset','dataset_version','from','to','scope','detector','direction','review','sort','cursor','origin','horizon','model','view','channel','max_buckets','min_peak_score']:
                params.append({'name':name,'in':'query','schema':{'type':'string'}})
        else:
            params.append({'name':'Idempotency-Key','in':'header','schema':{'type':'string'}})
            op['requestBody']={'required':True,'content':{'application/json':{'schema':{'type':'object','additionalProperties':True}}}}
        op['parameters']=params;paths[path][method]=op
schema={'openapi':'3.0.3','info':{'title':'VoltIQ FRONTEND DRAFT - not authoritative backend schema','version':'0.1.0'},'servers':[{'url':'/api/v1'}],'paths':paths,'components':{'schemas':{'Envelope':{'type':'object','required':['data','meta'],'properties':{'data':{},'meta':{'type':'object','required':['schema_version','time_basis'],'properties':{'schema_version':{'type':'string'},'time_basis':{'type':'string'},'dataset_id':{'type':'string'},'dataset_version':{'type':'string'},'run_id':{'type':'string'},'from':{'type':'string'},'to':{'type':'string'},'next_cursor':{'type':'string','nullable':True}}}}},'Error':{'type':'object','properties':{'error':{'type':'object','properties':{'code':{'type':'string'},'message':{'type':'string'},'details':{},'request_id':{'type':'string'}}}}}}}}
pathlib.Path('contracts/frontend-api-draft.json').write_text(json.dumps(schema,indent=2)+'\n')
