import { workforce } from '../data/synthetic-healthcare.mjs';

const REQUEST_BUCKETS=[0.05,0.1,0.25,0.5,1,2,5,10,30];
const MODEL_BUCKETS=[0.05,0.1,0.25,0.5,1,2,5,10,30,60];

const counters={
  requests:new Map(),
  modelCalls:new Map(),
  modelTokens:new Map(),
  modelTurns:new Map(),
  tools:new Map(),
  grounding:new Map(),
  abstentions:new Map(),
  interventions:new Map()
};
const histograms={
  requestDuration:new Map(),
  modelDuration:new Map()
};
const events=[];
const MAX_EVENTS=120;

function orderedLabels(labels={}){
  return Object.fromEntries(Object.entries(labels)
    .filter(([,v])=>v!==undefined&&v!==null&&v!=='')
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>[k,String(v)]));
}
function keyFor(labels){return JSON.stringify(orderedLabels(labels));}
function increment(map,labels,value=1){
  const clean=orderedLabels(labels);
  const key=keyFor(clean);
  const current=map.get(key)||{labels:clean,value:0};
  current.value+=Number(value)||0;
  map.set(key,current);
}
function observe(map,buckets,labels,value){
  const clean=orderedLabels(labels);
  const key=keyFor(clean);
  const current=map.get(key)||{labels:clean,buckets:buckets.map(x=>({le:x,count:0})),sum:0,count:0};
  const v=Math.max(0,Number(value)||0);
  current.count+=1;
  current.sum+=v;
  for(const b of current.buckets)if(v<=b.le)b.count+=1;
  map.set(key,current);
}
function pushEvent(event){
  events.unshift({at:new Date().toISOString(),...event});
  if(events.length>MAX_EVENTS)events.length=MAX_EVENTS;
}
function normalizeDecision(value=''){
  const d=String(value||'').toUpperCase();
  if(d.includes('ABSTAIN'))return'abstained';
  if(d.includes('BLOCK')||d.includes('DENIED')||d.includes('REJECT'))return'blocked';
  if(d.includes('REVIEW')||d.includes('DRAFT')||d.includes('PENDING'))return'review';
  return'allowed';
}
function statusClass(status){
  const n=Number(status);
  if(!Number.isFinite(n))return'error';
  if(n>=200&&n<300)return'2xx';
  if(n>=400&&n<500)return'4xx';
  if(n>=500)return'5xx';
  return'other';
}
function gatewayGuardrail(result){
  const message=result?.error?.message&&typeof result.error.message==='object'
    ?result.error.message
    :result?.raw?.message&&typeof result.raw.message==='object'
      ?result.raw.message
      :null;
  return message?.interveningGuardrail
    ?{
        policy:String(message.interveningGuardrail),
        reason:String(message.reasonCode||message.action||'GATEWAY_INTERVENTION')
      }
    :null;
}
function groundingOutcome(result){
  const reasons=new Set(result?.reasonCodes||[]);
  if(reasons.has('TRUSTED_CLINICAL_SOURCE_REQUIRED')||reasons.has('REQUIRED_CLINICAL_CONTEXT_MISSING'))return'withheld';
  const evidence=result?.evidence||[];
  if(evidence.length>0)return'grounded';
  return'not_required';
}
function roleFor(args={}){
  const actor=workforce[args.actorId];
  return actor?.role|| (args.app==='patient-support'?'patient':'unknown');
}
function counterTotal(map,filter=()=>true){
  let total=0;
  for(const x of map.values())if(filter(x.labels))total+=x.value;
  return total;
}
function ranked(map,labelName,limit=8){
  const sums=new Map();
  for(const {labels,value} of map.values()){
    const k=labels[labelName]||'unknown';
    sums.set(k,(sums.get(k)||0)+value);
  }
  return [...sums.entries()].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([name,value])=>({name,value}));
}
function histogramQuantile(map,q){
  let total=0,sum=0;
  const bucketTotals=new Map();
  for(const h of map.values()){
    total+=h.count;sum+=h.sum;
    for(const b of h.buckets)bucketTotals.set(b.le,(bucketTotals.get(b.le)||0)+b.count);
  }
  if(!total)return 0;
  const target=total*q;
  for(const le of [...bucketTotals.keys()].sort((a,b)=>a-b)){
    if(bucketTotals.get(le)>=target)return le;
  }
  return sum/total;
}

export function resetObservability(){
  for(const map of Object.values(counters))map.clear();
  for(const map of Object.values(histograms))map.clear();
  events.length=0;
  return executiveObservabilitySnapshot();
}

export function recordModelCall({context={},proxy='unknown',model='unknown',status=0,latencyMs=0,usage={},error=null}={}){
  const app=context?.app||'unknown';
  const labels={app,proxy,model,status:statusClass(status)};
  increment(counters.modelCalls,labels);
  observe(histograms.modelDuration,MODEL_BUCKETS,{app,proxy,model},Number(latencyMs)/1000);
  for(const [type,value] of Object.entries({
    input:Number(usage?.inputTokens||0),
    output:Number(usage?.outputTokens||0),
    total:Number(usage?.totalTokens||0)
  })){
    if(value>0)increment(counters.modelTokens,{app,proxy,model,type},value);
  }
  const g=gatewayGuardrail({error});
  if(g){
    increment(counters.interventions,{layer:'wso2_gateway',policy:g.policy,reason:g.reason});
    pushEvent({type:'POLICY_INTERVENTION',layer:'wso2_gateway',policy:g.policy,reason:g.reason,app,model,latencyMs:Math.round(latencyMs)});
  }
}

export function recordCopilotInteraction({args={},result=null,error=null,durationMs=0}={}){
  const app=args.app||'clinician';
  const role=roleFor(args);
  const purpose=args.purpose||'inferred';
  const decision=result?.decision||(error?'ERROR':'UNKNOWN');
  const outcome=error?'blocked':normalizeDecision(decision);
  increment(counters.requests,{app,outcome});
  observe(histograms.requestDuration,REQUEST_BUCKETS,{app,outcome},Number(durationMs)/1000);

  const turns=Number(result?.agent?.modelTurns||0);
  if(turns>0)increment(counters.modelTurns,{app},turns);

  const toolExecutions=result?.agent?.toolExecutions||result?.toolExecutions||[];
  for(const tool of toolExecutions){
    increment(counters.tools,{app,role,tool:tool?.name||'unknown',status:String(tool?.status||'OK')});
  }

  const grounding=groundingOutcome(result||{});
  increment(counters.grounding,{app,outcome:grounding});

  const reasons=[...new Set(result?.reasonCodes||[error?.code].filter(Boolean))];
  if(outcome==='abstained'){
    for(const reason of reasons.length?reasons:['UNSPECIFIED_ABSTENTION']){
      increment(counters.abstentions,{app,reason});
    }
  }

  const guardrail=gatewayGuardrail(result?.gateway||{});
  if(!guardrail && (outcome==='blocked'||outcome==='abstained'||outcome==='review')){
    const layer=result?.gateway?.invoked===false
      ?'pre_model'
      :(turns>0?'post_model':'application');
    for(const reason of reasons.length?reasons:['GOVERNED_DECISION']){
      increment(counters.interventions,{layer,policy:'helios-governance',reason});
    }
  }

  pushEvent({
    type:'AI_REQUEST',
    traceId:result?.traceId||null,
    app,
    role,
    purpose,
    outcome,
    decision:String(decision),
    durationMs:Math.round(durationMs),
    model:result?.gateway?.model||result?.model?.model||null,
    modelTurns:turns,
    tools:toolExecutions.map(x=>x?.name).filter(Boolean),
    grounding,
    reasonCodes:reasons.slice(0,8)
  });
}

export function executiveObservabilitySnapshot(){
  const requests=counterTotal(counters.requests);
  const allowed=counterTotal(counters.requests,l=>l.outcome==='allowed');
  const blocked=counterTotal(counters.requests,l=>l.outcome==='blocked');
  const abstained=counterTotal(counters.requests,l=>l.outcome==='abstained');
  const review=counterTotal(counters.requests,l=>l.outcome==='review');
  return {
    generatedAt:new Date().toISOString(),
    platform:{
      metrics:'Prometheus',
      dashboard:'Grafana',
      gateway:'WSO2 AI Gateway 1.2',
      telemetryModel:'Helios semantic metrics + WSO2 native component metrics'
    },
    requests:{total:requests,allowed,blocked,abstained,review},
    latencyMs:{
      p50:Math.round(histogramQuantile(histograms.requestDuration,.50)*1000),
      p95:Math.round(histogramQuantile(histograms.requestDuration,.95)*1000),
      p99:Math.round(histogramQuantile(histograms.requestDuration,.99)*1000)
    },
    model:{
      calls:counterTotal(counters.modelCalls),
      inputTokens:counterTotal(counters.modelTokens,l=>l.type==='input'),
      outputTokens:counterTotal(counters.modelTokens,l=>l.type==='output'),
      totalTokens:counterTotal(counters.modelTokens,l=>l.type==='total'),
      turns:counterTotal(counters.modelTurns)
    },
    grounding:{
      grounded:counterTotal(counters.grounding,l=>l.outcome==='grounded'),
      withheld:counterTotal(counters.grounding,l=>l.outcome==='withheld'),
      notRequired:counterTotal(counters.grounding,l=>l.outcome==='not_required')
    },
    topTools:ranked(counters.tools,'tool'),
    topPolicyInterventions:ranked(counters.interventions,'reason'),
    recentEvents:events.slice(0,12)
  };
}

export function observabilityEvents({limit=50}={}){
  return events.slice(0,Math.max(1,Math.min(Number(limit)||50,100))).map(x=>structuredClone(x));
}

function esc(v){return String(v).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/"/g,'\\"');}
function labelString(labels={}){
  const items=Object.entries(labels);
  return items.length?`{${items.map(([k,v])=>`${k}="${esc(v)}"`).join(',')}}`:'';
}
function renderCounter(name,help,map){
  const lines=[`# HELP ${name} ${help}`,`# TYPE ${name} counter`];
  for(const {labels,value} of map.values())lines.push(`${name}${labelString(labels)} ${value}`);
  return lines;
}
function renderHistogram(name,help,map){
  const lines=[`# HELP ${name} ${help}`,`# TYPE ${name} histogram`];
  for(const h of map.values()){
    for(const b of h.buckets)lines.push(`${name}_bucket${labelString({...h.labels,le:b.le})} ${b.count}`);
    lines.push(`${name}_bucket${labelString({...h.labels,le:'+Inf'})} ${h.count}`);
    lines.push(`${name}_sum${labelString(h.labels)} ${h.sum}`);
    lines.push(`${name}_count${labelString(h.labels)} ${h.count}`);
  }
  return lines;
}

export function prometheusMetrics(){
  const lines=[
    '# HELP helios_observability_info Helios executive observability exporter information',
    '# TYPE helios_observability_info gauge',
    `helios_observability_info{gateway="wso2-ai-gateway-1.2",mode="${esc(process.env.LLM_MODE||'deterministic')}"} 1`,
    ...renderCounter('helios_ai_requests_total','Governed AI requests by application and normalized outcome.',counters.requests),
    ...renderHistogram('helios_ai_request_duration_seconds','End-to-end Helios BFF request duration.',histograms.requestDuration),
    ...renderCounter('helios_ai_model_calls_total','Model calls routed through the WSO2 AI Gateway.',counters.modelCalls),
    ...renderHistogram('helios_ai_model_call_duration_seconds','Model call duration through the WSO2 AI Gateway.',histograms.modelDuration),
    ...renderCounter('helios_ai_model_tokens_total','Provider-reported model tokens by type.',counters.modelTokens),
    ...renderCounter('helios_ai_model_turns_total','Agent model turns observed by application.',counters.modelTurns),
    ...renderCounter('helios_ai_tools_total','Server-authorized tool executions.',counters.tools),
    ...renderCounter('helios_ai_grounding_total','Helios grounding outcome classification.',counters.grounding),
    ...renderCounter('helios_ai_abstentions_total','Governed abstentions by reason.',counters.abstentions),
    ...renderCounter('helios_ai_policy_interventions_total','Policy interventions by enforcement layer, policy and reason.',counters.interventions)
  ];
  return lines.join('\n')+'\n';
}
