import {gatewayConfig} from './gateway-client.mjs';
const auth='Basic '+Buffer.from(`${process.env.WSO2_ADMIN_USER||'admin'}:${process.env.WSO2_ADMIN_PASSWORD||'admin'}`).toString('base64');
async function getText(url,{authHeader=false}={}){try{const r=await fetch(url,{headers:authHeader?{Authorization:auth,Accept:'application/json'}:{}});const text=await r.text();let body;try{body=text?JSON.parse(text):null}catch{body=text};return {ok:r.ok,status:r.status,body}}catch(err){return {ok:false,status:0,error:err.message}}}
async function detectBase(){for(const suffix of ['/api/management/v0.9','/api/management/v1']){const r=await getText(`http://localhost:9090${suffix}/llm-providers`,{authHeader:true});if(r.ok)return `http://localhost:9090${suffix}`;}return null}
export async function gatewayRuntimeStatus(){
 const cfg=gatewayConfig();
 if(cfg.mode!=='gateway')return {mode:cfg.mode,endToEnd:false,controller:{ok:false,reason:'deterministic mode'},runtime:{ok:false,reason:'deterministic mode'},proxies:[]};
 const [controllerHealth,runtimeReady]=await Promise.all([getText('http://localhost:9094/health'),getText('http://localhost:9901/ready')]);
 const base=await detectBase();const proxies=[];
 if(base)for(const id of ['clinical-ai-secure','patient-support-ai-secure']){const r=await getText(`${base}/llm-proxies/${id}`,{authHeader:true});proxies.push({id,ok:r.ok,status:r.status,state:r.body?.status?.state||null,context:r.body?.spec?.context||null,provider:r.body?.spec?.provider?.id||null,policies:(r.body?.spec?.policies||[]).map(p=>p.name)});}
 return {mode:cfg.mode,endToEnd:controllerHealth.ok&&runtimeReady.ok&&proxies.length===2&&proxies.every(p=>p.ok),controller:{ok:controllerHealth.ok,status:controllerHealth.status},runtime:{ok:runtimeReady.ok,status:runtimeReady.status},managementApi:base,ingress:cfg.baseUrl,proxies};
}
