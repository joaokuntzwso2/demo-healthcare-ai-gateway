import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const controller=process.env.CONTROLLER_URL||'http://localhost:9090';
const user=process.env.ADMIN_USER||'admin';
const pass=process.env.ADMIN_PASSWORD||'admin';
const auth='Basic '+Buffer.from(`${user}:${pass}`).toString('base64');

async function req(url,{method='GET',headers={},body}={}){
  const r=await fetch(url,{method,headers:{Authorization:auth,Accept:'application/json',...headers},body});
  const text=await r.text(); let data;
  try{data=text?JSON.parse(text):null}catch{data=text}
  return {status:r.status,ok:r.ok,data,text};
}
async function detectBase(){
  for(const suffix of ['/api/management/v0.9','/api/management/v1']){
    const r=await req(`${controller}${suffix}/llm-proxies`);
    if(r.ok) return `${controller}${suffix}`;
  }
  throw new Error(`Could not detect WSO2 management API at ${controller}`);
}
const base=await detectBase();
console.log(`Management API: ${base}`);

for(const [id,file] of [['clinical-ai-secure','clinical-policy-chain.json'],['patient-support-ai-secure','patient-support-policy-chain.json']]){
  const current=await req(`${base}/llm-proxies/${encodeURIComponent(id)}`);
  if(!current.ok) throw new Error(`Cannot read ${id}: HTTP ${current.status}: ${current.text}`);
  const chain=JSON.parse(await readFile(resolve(root,'modular-ai-guardrails/config',file),'utf8'));
  for(const stage of chain){
    for(const binding of (stage.paths||[])){
      if(stage.name!=='api-key-auth' && binding.path!=='/v1/chat/completions') throw new Error(`${file}: ${stage.name} has invalid proxy resource ${binding.path}; expected /v1/chat/completions`);
    }
  }
  const obj=current.data;
  delete obj.status;
  obj.spec.policies=chain;
  const updated=await req(`${base}/llm-proxies/${encodeURIComponent(id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
  if(!updated.ok) throw new Error(`Updating ${id}: HTTP ${updated.status}: ${updated.text}`);
  console.log(`${id}: reapplied ${chain.length}-stage chain on /v1/chat/completions`);
}
