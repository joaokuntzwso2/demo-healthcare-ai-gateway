import {readFile,writeFile,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
import crypto from 'node:crypto';

const root=resolve(import.meta.dirname,'..');
const gateway=resolve(root,'wso2apip-healthcare-ai-gateway-1.1.0');
const controller=process.env.CONTROLLER_URL||'http://localhost:9090';
const user=process.env.ADMIN_USER||'admin';
const pass=process.env.ADMIN_PASSWORD||'admin';
const openai=process.env.OPENAI_API_KEY;
if(!openai) throw new Error('OPENAI_API_KEY is required for real end-to-end Gateway mode.');
const auth='Basic '+Buffer.from(`${user}:${pass}`).toString('base64');
const ISSUER='api-platform-devportal';
const PROVIDER='enterprise-openai';
const PROVIDER_HEADER='X-API-Key';

async function req(url,{method='GET',headers={},body}={}){
  const r=await fetch(url,{method,headers:{Authorization:auth,Accept:'application/json',...headers},body});
  const text=await r.text(); let data; try{data=text?JSON.parse(text):null}catch{data=text}
  return {status:r.status,ok:r.ok,data,text};
}
async function detectBase(){
  for(const suffix of ['/api/management/v0.9','/api/management/v1']){
    const r=await req(`${controller}${suffix}/llm-providers`); if(r.ok) return `${controller}${suffix}`;
  }
  throw new Error(`Could not detect WSO2 management API at ${controller}.`);
}
const base=await detectBase();
console.log(`Management API: ${base}`);
const get=(kind,id)=>req(`${base}/${kind}/${encodeURIComponent(id)}`);
const postYaml=(kind,yaml)=>req(`${base}/${kind}`,{method:'POST',headers:{'Content-Type':'application/yaml'},body:yaml});
const putJson=(kind,id,obj)=>req(`${base}/${kind}/${encodeURIComponent(id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const apiKeyPolicy={name:'api-key-auth',version:'v1',paths:[{path:'/*',methods:['*'],params:{in:'header',key:PROVIDER_HEADER}}]};

async function ensureProvider(){
  let cur=await get('llm-providers',PROVIDER);
  if(cur.status===404){
    let yaml=await readFile(resolve(gateway,'enterprise-openai.template.yaml'),'utf8');
    yaml=yaml.replace('__OPENAI_API_KEY__',openai);
    const c=await postYaml('llm-providers',yaml);
    if(!c.ok&&c.status!==409) throw new Error(`Creating provider failed HTTP ${c.status}: ${c.text}`);
    await sleep(800);
    cur=await get('llm-providers',PROVIDER);
  }
  if(!cur.ok) throw new Error(`Provider lookup failed HTTP ${cur.status}: ${cur.text}`);
  const obj=cur.data; delete obj.status;
  obj.spec.upstream ||= {}; obj.spec.upstream.url='https://api.openai.com/v1';
  obj.spec.upstream.auth={type:'api-key',header:'Authorization',value:`Bearer ${openai}`};
  // Banking-reference trust boundary: client/proxy -> Provider is separately authenticated.
  const existing=(obj.spec.policies||[]).filter(p=>p.name!=='api-key-auth');
  obj.spec.policies=[apiKeyPolicy,...existing];
  const u=await putJson('llm-providers',PROVIDER,obj);
  if(!u.ok) throw new Error(`Updating provider failed HTTP ${u.status}: ${u.text}`);
  console.log('Provider enterprise-openai configured with separate X-API-Key access control.');
}

async function generateKey(kind,id,label){
  const payload={name:`helios-${label}-${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}`,issuer:ISSUER};
  const r=await req(`${base}/${kind}/${encodeURIComponent(id)}/api-keys`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const key=r.data?.apiKey?.apiKey;
  if(!r.ok||typeof key!=='string'||key.length<16) throw new Error(`Generating ${label} key failed HTTP ${r.status}: ${r.text}`);
  console.log(`${label}: generated key fingerprint ${crypto.createHash('sha256').update(key).digest('hex').slice(0,12)}.`);
  return key;
}

async function ensureProxy(id,file){
  const cur=await get('llm-proxies',id);
  if(cur.ok){console.log(`Proxy ${id} exists.`);return;}
  if(cur.status!==404) throw new Error(`Proxy ${id} lookup failed HTTP ${cur.status}: ${cur.text}`);
  const yaml=await readFile(resolve(gateway,file),'utf8');
  const c=await postYaml('llm-proxies',yaml);
  if(!c.ok&&c.status!==409) throw new Error(`Creating proxy ${id} failed HTTP ${c.status}: ${c.text}`);
  console.log(`Proxy ${id} created.`);
}

async function applyProxy(id,file,providerKey){
  const chain=JSON.parse(await readFile(resolve(root,'modular-ai-guardrails/config',file),'utf8'));
  const cur=await get('llm-proxies',id); if(!cur.ok) throw new Error(`Cannot read proxy ${id}: HTTP ${cur.status}: ${cur.text}`);
  const obj=cur.data; delete obj.status;
  obj.spec.provider={...(obj.spec.provider||{}),id:PROVIDER,auth:{type:'api-key',header:PROVIDER_HEADER,value:providerKey}};
  obj.spec.policies=chain;
  const u=await putJson('llm-proxies',id,obj); if(!u.ok) throw new Error(`Applying ${id} failed HTTP ${u.status}: ${u.text}`);
  for(let i=0;i<30;i++){
    const v=await get('llm-proxies',id);
    const names=(v.data?.spec?.policies||[]).map(x=>x.name);
    if(v.ok&&JSON.stringify(names)===JSON.stringify(chain.map(x=>x.name))&&v.data?.spec?.provider?.auth?.header===PROVIDER_HEADER){
      console.log(`${id}: ${names.length}-stage chain + provider credential active in Controller state.`); return;
    }
    await sleep(1000);
  }
  throw new Error(`${id}: proxy configuration did not converge.`);
}

function parseEnv(text){const o={};for(const line of text.split(/\r?\n/)){const s=line.trim();if(!s||s.startsWith('#')||!s.includes('='))continue;const i=s.indexOf('=');let v=s.slice(i+1).trim();if((v.startsWith("'")&&v.endsWith("'"))||(v.startsWith('"')&&v.endsWith('"')))v=v.slice(1,-1).replace(/'\\''/g,"'");o[s.slice(0,i).trim()]=v;}return o}
const quote=v=>`'${String(v).replace(/'/g,"'\\''")}'`;
async function writeRuntimeEnv(providerKey,clinicalKey,patientKey){
  const path=resolve(root,'.helios.env'); let env={}; try{env=parseEnv(await readFile(path,'utf8'))}catch{}
  Object.assign(env,{LLM_MODE:'gateway',WSO2_AI_GATEWAY_URL:'https://localhost:8443',WSO2_TLS_INSECURE:'true',WSO2_API_KEY_HEADER:'X-API-Key',WSO2_DEFAULT_MODEL:env.WSO2_DEFAULT_MODEL||'gpt-4o-mini',WSO2_PROVIDER_ACCESS_KEY:providerKey,WSO2_CLINICAL_PROXY_API_KEY:clinicalKey,WSO2_PATIENT_PROXY_API_KEY:patientKey});
  const ordered=['LLM_MODE','WSO2_AI_GATEWAY_URL','WSO2_TLS_INSECURE','WSO2_API_KEY_HEADER','WSO2_DEFAULT_MODEL','WSO2_PROVIDER_ACCESS_KEY','WSO2_CLINICAL_PROXY_API_KEY','WSO2_PATIENT_PROXY_API_KEY','HELIOS_CONTEXT_SIGNING_KEY','HELIOS_PSEUDONYM_KEY','HELIOS_APPROVAL_KEY','HELIOS_KNOWLEDGE_SIGNING_KEY'];
  await writeFile(path,ordered.filter(k=>env[k]).map(k=>`${k}=${quote(env[k])}`).join('\n')+'\n'); await chmod(path,0o600);
}

await ensureProvider();
const providerKey=await generateKey('llm-providers',PROVIDER,'provider-access');
await ensureProxy('clinical-ai-secure','clinical-ai-secure.yaml');
await ensureProxy('patient-support-ai-secure','patient-support-ai-secure.yaml');
await applyProxy('clinical-ai-secure','clinical-policy-chain.json',providerKey);
await applyProxy('patient-support-ai-secure','patient-support-policy-chain.json',providerKey);
const clinicalKey=await generateKey('llm-proxies','clinical-ai-secure','clinical-proxy');
const patientKey=await generateKey('llm-proxies','patient-support-ai-secure','patient-proxy');
await writeRuntimeEnv(providerKey,clinicalKey,patientKey);
console.log('WSO2 provider/proxies/provider-auth/proxy-auth/policies/keys bootstrapped.');
