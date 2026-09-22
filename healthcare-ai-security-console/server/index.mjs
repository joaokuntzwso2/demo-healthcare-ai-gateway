import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeKnowledge } from './services/knowledge.mjs';
import { listTraces, getTrace } from './services/evidence.mjs';
import { gatewayConfig } from './services/gateway-client.mjs';
import { clinicianTools, patientTools } from './services/tools.mjs';
import { runCopilot } from './services/copilot.mjs';
import { gatewayRuntimeStatus } from './services/runtime-status.mjs';
import { runGatewayGuardrailProbe } from './services/demo-journey.mjs';
import { demoCatalog } from './services/demo-catalog.mjs';

const ROOT=resolve(fileURLToPath(new URL('../',import.meta.url)));
const UI=resolve(ROOT,process.env.NODE_ENV==='production'?'dist':'public');
const PORT=Number(process.env.PORT||5173);
await initializeKnowledge();

const json=(res,status,body)=>{const data=JSON.stringify(body,null,2);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(data)};
async function body(req,limit=1024*1024){let d='';for await(const c of req){d+=c;if(Buffer.byteLength(d)>limit)throw Object.assign(new Error('Payload too large'),{status:413});}return d;}
async function jsonBody(req){const d=await body(req);return d?JSON.parse(d):{};}

const architecture={
  flow:['REQUEST','SIGNED CONTEXT','WSO2 AI GATEWAY','MODEL REASONING','SERVER TOOL','AUTHORITATIVE SOURCE','GROUNDED RESPONSE','AUDIT TRACE'],
  trustBoundaries:[
    {label:'PATIENT DATA',state:'AUTHORITATIVE'},
    {label:'CLINICAL KNOWLEDGE',state:'TRUSTED / VERSIONED'},
    {label:'LLM OUTPUT',state:'GENERATED / VALIDATED'},
    {label:'CLINICAL ACTION',state:'HUMAN-GATED'}
  ],
  applications:{clinician:{proxy:'clinical-ai-secure',tools:clinicianTools},patientSupport:{proxy:'patient-support-ai-secure',tools:patientTools}},
  principle:'The model reasons inside bounded application contexts. Identity, clinical facts, tool authority, policy enforcement and action approval remain deterministic and server-controlled.'
};

// These legacy fixture APIs are intentionally unavailable to the presentation UI.
// The demo surface must exercise governed AI flows rather than reading mock/reference stores directly.
const retiredFixtureRoutes=new Set(['/api/overview','/api/scenarios','/api/knowledge','/api/knowledge/ingest','/api/reference-data']);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};

const server=http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&u.pathname==='/api/health')return json(res,200,{ok:true,product:'Helios Clinical AI Security',gateway:gatewayConfig()});
  if(req.method==='GET'&&u.pathname==='/api/gateway-status')return json(res,200,await gatewayRuntimeStatus());
  if(req.method==='GET'&&u.pathname==='/api/demo/catalog')return json(res,200,demoCatalog());
  if(req.method==='GET'&&u.pathname==='/api/traces')return json(res,200,{traces:listTraces()});
  if(req.method==='GET'&&u.pathname.startsWith('/api/traces/')){const t=getTrace(u.pathname.split('/').pop());return t?json(res,200,t):json(res,404,{error:'Trace not found'});}
  if(req.method==='GET'&&u.pathname==='/api/architecture')return json(res,200,architecture);
  if(req.method==='POST'&&u.pathname==='/api/copilot'){const b=await jsonBody(req);return json(res,200,await runCopilot({...b,app:'clinician'}));}
  if(req.method==='POST'&&u.pathname==='/api/patient-support'){const b=await jsonBody(req);return json(res,200,await runCopilot({...b,app:'patient-support'}));}
  if(req.method==='POST'&&u.pathname==='/api/demo/guardrail-probe'){const b=await jsonBody(req);return json(res,200,await runGatewayGuardrailProbe(b));}
  if(retiredFixtureRoutes.has(u.pathname)||u.pathname.startsWith('/api/scenarios/'))return json(res,410,{error:'Direct fixture access is disabled in the presentation application. Use the governed AI endpoints instead.',code:'DIRECT_FIXTURE_ACCESS_DISABLED'});
  if(u.pathname.startsWith('/api/'))return json(res,404,{error:'API route not found'});

  let path=u.pathname==='/'?'index.html':u.pathname.replace(/^\//,'');
  path=resolve(UI,path);
  if(!path.startsWith(UI))return json(res,403,{error:'Forbidden'});
  try{
    const s=await stat(path);if(s.isDirectory())path=resolve(path,'index.html');
    const data=await readFile(path);
    res.writeHead(200,{
      'content-type':mime[extname(path)]||'application/octet-stream',
      'cache-control':extname(path)==='.html'?'no-store':'public, max-age=300',
      'x-content-type-options':'nosniff',
      'content-security-policy':"default-src 'self' https://esm.sh; script-src 'self' https://esm.sh; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"
    });
    return res.end(data);
  }catch{return json(res,404,{error:'Not found'});}
}catch(err){return json(res,err.status||400,{error:err.message,code:err.code||'BAD_REQUEST'});}});
server.listen(PORT,'0.0.0.0',()=>console.log(`Helios Clinical AI Security console listening on http://localhost:${PORT}`));
