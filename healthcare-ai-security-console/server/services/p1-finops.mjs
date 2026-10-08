import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CLINICAL_CHAIN=fileURLToPath(new URL('../../../modular-ai-guardrails/config/clinical-policy-chain.json',import.meta.url));
const PATIENT_CHAIN=fileURLToPath(new URL('../../../modular-ai-guardrails/config/patient-support-policy-chain.json',import.meta.url));
const PRICES=fileURLToPath(new URL('../../../wso2apip-ai-gateway-1.2.0/configs/llm-pricing/model_prices.json',import.meta.url));

function loadJson(path){return JSON.parse(readFileSync(path,'utf8'))}
function budgetFrom(path){
  const stage=loadJson(path).find(x=>x.name==='llm-cost-based-ratelimit');
  const item=stage?.paths?.[0]?.params?.budgetLimits?.[0];
  return {amount:Number(item?.amount||0),duration:String(item?.duration||'24h')};
}
const config={
  clinician:{label:'Clinician AI',...budgetFrom(CLINICAL_CHAIN)},
  'patient-support':{label:'Patient AI',...budgetFrom(PATIENT_CHAIN)}
};
const prices=loadJson(PRICES);
const state=new Map(Object.keys(config).map(k=>[k,{
  calls:0,inputTokens:0,outputTokens:0,totalTokens:0,latencies:[],
  estimatedCostUsd:0,gatewayLimitUsd:null,gatewayRemainingUsd:null,
  gatewayHeadersObserved:false,lastModel:null
}]));

function s(app){return state.get(app)}
function header(headers,name){
  const raw=headers?.[name]??headers?.[name.toLowerCase()];
  const v=Number(Array.isArray(raw)?raw[0]:raw);
  return Number.isFinite(v)?v:null;
}
function round(v,n=10){return Number(Number(v||0).toFixed(n))}
function percentile(values,q){
  if(!values.length)return 0;
  const a=[...values].sort((x,y)=>x-y);
  return a[Math.max(0,Math.ceil(a.length*q)-1)];
}
function pricingFor(model){
  const exact=prices[String(model||'')];
  if(exact)return exact;
  const clean=String(model||'').replace(/^openai\//,'');
  return prices[clean]||null;
}
function estimatedCallCost(model,usage={}){
  const p=pricingFor(model);
  if(!p)return {usd:0,pricingFound:false};
  const input=Number(usage.inputTokens||0),output=Number(usage.outputTokens||0);
  return {usd:(input*Number(p.input_cost_per_token||0))+(output*Number(p.output_cost_per_token||0)),pricingFound:true};
}
export function recordGatewayBudgetHeaders({app='unknown',headers={}}={}){
  const x=s(app); if(!x)return;
  const limit=header(headers,'x-ratelimit-cost-limit-dollars');
  const remaining=header(headers,'x-ratelimit-cost-remaining-dollars');
  if(limit===null&&remaining===null)return;
  if(limit!==null)x.gatewayLimitUsd=limit;
  if(remaining!==null)x.gatewayRemainingUsd=remaining;
  x.gatewayHeadersObserved=true;
}
export function recordFinOpsModelCall({app='unknown',status=0,latencyMs=0,usage={},model='unknown'}={}){
  const x=s(app); if(!x)return;
  const successful=Number(status)>=200&&Number(status)<300;
  const total=Number(usage?.totalTokens||0);
  if(!successful||total<=0)return;
  const input=Number(usage?.inputTokens||0),output=Number(usage?.outputTokens||0);
  x.calls+=1;x.inputTokens+=input;x.outputTokens+=output;x.totalTokens+=total;
  x.latencies.push(Math.max(0,Number(latencyMs)||0));
  if(x.latencies.length>2048)x.latencies.splice(0,x.latencies.length-2048);
  x.estimatedCostUsd+=estimatedCallCost(model,usage).usd;
  x.lastModel=model;
}
export function resetFinOps(){
  for(const app of state.keys())state.set(app,{
    calls:0,inputTokens:0,outputTokens:0,totalTokens:0,latencies:[],
    estimatedCostUsd:0,gatewayLimitUsd:null,gatewayRemainingUsd:null,
    gatewayHeadersObserved:false,lastModel:null
  });
}
function snapshot(app){
  const cfg=config[app],x=s(app);
  const configuredBudgetUsd=x.gatewayLimitUsd??cfg.amount;
  const gatewayAccountedCostUsd=(x.gatewayLimitUsd!==null&&x.gatewayRemainingUsd!==null)
    ?Math.max(0,x.gatewayLimitUsd-x.gatewayRemainingUsd):null;
  const effective=gatewayAccountedCostUsd??x.estimatedCostUsd;
  const remaining=x.gatewayRemainingUsd!==null?Math.max(0,x.gatewayRemainingUsd):Math.max(0,configuredBudgetUsd-effective);
  const avg=x.latencies.length?x.latencies.reduce((a,b)=>a+b,0)/x.latencies.length:0;
  return {
    app,label:cfg.label,calls:x.calls,inputTokens:x.inputTokens,outputTokens:x.outputTokens,totalTokens:x.totalTokens,
    averageModelLatencyMs:Math.round(avg),p95ModelLatencyMs:Math.round(percentile(x.latencies,.95)),
    estimatedCostUsd:round(x.estimatedCostUsd),
    gatewayAccountedCostUsd:gatewayAccountedCostUsd===null?null:round(gatewayAccountedCostUsd),
    monetaryConsumptionUsd:round(effective),configuredBudgetUsd:round(configuredBudgetUsd),
    remainingBudgetUsd:round(remaining),
    percentConsumed:configuredBudgetUsd>0?Number(Math.min(100,(effective/configuredBudgetUsd)*100).toFixed(2)):0,
    budgetWindow:cfg.duration,
    accountingSource:x.gatewayHeadersObserved?'wso2-native-budget-accounting':'helios-estimate-from-wso2-pricing-file',
    providerInvoice:false,model:x.lastModel,
    pricingSource:'wso2apip-ai-gateway-1.2.0/configs/llm-pricing/model_prices.json',
    pricingFound:Boolean(pricingFor(x.lastModel)),
    latencyDefinition:'BFF-to-WSO2-Gateway-to-provider round-trip for the model call',
    note:x.gatewayHeadersObserved
      ?'Gateway-accounted consumption is derived from WSO2 native USD budget headers. It is operational accounting, not the provider invoice.'
      :'Until WSO2 budget headers are observed, consumption is estimated from real provider token usage using the local WSO2 pricing file. It is not the provider invoice.'
  };
}
export function finOpsSnapshot(){
  return {
    message:"We don't only make clinical AI safer; we make its consumption governable.",
    currency:'USD',applications:Object.keys(config).map(snapshot),
    disclaimer:'Gateway-accounted or estimated consumption is operational governance data, not an OpenAI/provider invoice.'
  };
}
export function finOpsPrometheusMetrics(){
  const lines=[
    '# HELP helios_ai_operational_cost_usd Gateway-accounted or WSO2-pricing-based operational AI cost; not provider invoice.',
    '# TYPE helios_ai_operational_cost_usd gauge',
    '# HELP helios_ai_budget_usd Configured native WSO2 LLM cost budget.',
    '# TYPE helios_ai_budget_usd gauge',
    '# HELP helios_ai_budget_remaining_usd Remaining native WSO2 budget, or local estimate until headers are observed.',
    '# TYPE helios_ai_budget_remaining_usd gauge'
  ];
  for(const x of finOpsSnapshot().applications){
    lines.push(`helios_ai_operational_cost_usd{app="${x.app}",source="${x.accountingSource}"} ${x.monetaryConsumptionUsd}`);
    lines.push(`helios_ai_budget_usd{app="${x.app}",window="${x.budgetWindow}"} ${x.configuredBudgetUsd}`);
    lines.push(`helios_ai_budget_remaining_usd{app="${x.app}",window="${x.budgetWindow}"} ${x.remainingBudgetUsd}`);
  }
  return lines;
}
