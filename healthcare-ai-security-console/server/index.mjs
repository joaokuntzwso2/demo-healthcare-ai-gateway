import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarios } from '../server/scenarios.mjs';
import { runScenario } from './services/scenario-runner.mjs';
import { initializeKnowledge, listKnowledge, ingestDocument } from './services/knowledge.mjs';
import { listTraces, getTrace } from './services/evidence.mjs';
import { gatewayConfig } from './services/gateway-client.mjs';
import { organizations, workforce, patients, syntheticSafetyRules } from './data/synthetic-healthcare.mjs';
import { clinicianTools, patientTools } from './services/tools.mjs';
import { purposeProfiles } from './services/minimization.mjs';
import { runCopilot } from './services/copilot.mjs';
import { gatewayRuntimeStatus } from './services/runtime-status.mjs';

const ROOT=resolve(fileURLToPath(new URL('../',import.meta.url))); const UI=resolve(ROOT,process.env.NODE_ENV==='production'?'dist':'public'); const PORT=Number(process.env.PORT||5173);
await initializeKnowledge();
const json=(res,status,body)=>{const data=JSON.stringify(body,null,2);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(data)};
async function body(req,limit=1024*1024){let d='';for await(const c of req){d+=c;if(Buffer.byteLength(d)>limit)throw Object.assign(new Error('Payload too large'),{status:413});}return d;}
async function jsonBody(req){const d=await body(req);return d?JSON.parse(d):{};}
const overview=()=>({product:'Helios Clinical AI Security',gateway:{name:'healthcare-ai-security-gateway',...gatewayConfig()},proxies:[{name:'clinical-ai-secure',context:'/clinical-ai-secure',capabilityClass:'workforce-clinical'},{name:'patient-support-ai-secure',context:'/patient-support-ai-secure',capabilityClass:'patient-low-privilege'}],policyState:{count:24,orderSignificant:true,canonicalizationBeforeContentChecks:true,requestRewriteLast:true},currentSyntheticClinician:workforce['clin-001'],currentSyntheticPatient:{id:patients['pat-1001'].pseudonym,label:'Synthetic Patient Alpha'},encounter:'enc-501',purpose:'encounter-summary',activeScopes:workforce['clin-001'].scopes,safetyState:{service:'helios-demo-clinical-safety',version:syntheticSafetyRules.version,status:'DEMONSTRATION_ONLY'},ragState:{accepted:listKnowledge({tenant:'helios-north'}).filter(x=>x.status==='accepted').length,quarantined:listKnowledge({tenant:'helios-north'}).filter(x=>x.status==='quarantined').length,evidenceOnly:listKnowledge({tenant:'helios-north'}).filter(x=>x.status==='evidence-only').length},recentDecisions:listTraces().slice(0,5)});
const architecture={flow:['REQUEST','IDENTITY','PATIENT BINDING','PURPOSE','DATA MINIMIZATION','RAG SOURCES','LLM','CLINICAL SAFETY SERVICE','ACTION AUTHORITY','CLINICIAN APPROVAL','OUTCOME'],trustBoundaries:[{label:'PATIENT DATA',state:'AUTHORITATIVE'},{label:'CLINICAL KNOWLEDGE',state:'TRUSTED / VERSIONED'},{label:'UPLOADED DOCUMENT',state:'UNTRUSTED EVIDENCE'},{label:'LLM OUTPUT',state:'NON-AUTHORITATIVE UNTIL VALIDATED'},{label:'DOMAIN SAFETY RESULT',state:'DETERMINISTIC'}],applications:{clinician:{proxy:'clinical-ai-secure',tools:clinicianTools},patientSupport:{proxy:'patient-support-ai-secure',tools:patientTools}},principle:'The model is a bounded drafting/reasoning component; identity, facts, data release, safety decisions, and clinical-action authority remain outside the model.'};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&u.pathname==='/api/health')return json(res,200,{ok:true,product:'Helios Clinical AI Security',gateway:gatewayConfig()});
 if(req.method==='GET'&&u.pathname==='/api/gateway-status')return json(res,200,await gatewayRuntimeStatus());
 if(req.method==='GET'&&u.pathname==='/api/overview')return json(res,200,overview());
 if(req.method==='GET'&&u.pathname==='/api/scenarios')return json(res,200,{scenarios});
 if(req.method==='POST'&&u.pathname.startsWith('/api/scenarios/')&&u.pathname.endsWith('/run')){const id=u.pathname.split('/')[3];return json(res,200,await runScenario(id));}
 if(req.method==='GET'&&u.pathname==='/api/knowledge')return json(res,200,{sources:listKnowledge({tenant:u.searchParams.get('tenant')||undefined})});
 if(req.method==='POST'&&u.pathname==='/api/knowledge/ingest'){const raw=await body(req);const result=ingestDocument({filename:req.headers['x-filename']||'upload.txt',content:raw,channel:req.headers['x-channel']||'untrusted',tenant:req.headers['x-tenant']||'helios-north',publisher:req.headers['x-publisher']||'Unknown Upload',version:req.headers['x-document-version']||'upload-1',reviewDate:req.headers['x-review-date']||'2027-01-01',specialty:req.headers['x-specialty']||'general'});return json(res,result.status,result.body);}
 if(req.method==='GET'&&u.pathname==='/api/traces')return json(res,200,{traces:listTraces()});
 if(req.method==='GET'&&u.pathname.startsWith('/api/traces/')){const t=getTrace(u.pathname.split('/').pop());return t?json(res,200,t):json(res,404,{error:'Trace not found'});}
 if(req.method==='GET'&&u.pathname==='/api/architecture')return json(res,200,architecture);
 if(req.method==='GET'&&u.pathname==='/api/reference-data')return json(res,200,{organizations:Object.values(organizations),workforce:Object.values(workforce).map(x=>({...x,scopes:[...x.scopes]})),patients:Object.values(patients).map(p=>({id:p.id,pseudonym:p.pseudonym,tenant:p.tenant,encounters:p.encounters.map(e=>e.id)})),purposeProfiles,syntheticSafetyRules});
 if(req.method==='POST'&&u.pathname==='/api/copilot'){const b=await jsonBody(req);return json(res,200,await runCopilot({...b,app:'clinician'}));}
 if(req.method==='POST'&&u.pathname==='/api/patient-support'){const b=await jsonBody(req);return json(res,200,await runCopilot({...b,app:'patient-support'}));}
 if(u.pathname.startsWith('/api/'))return json(res,404,{error:'API route not found'});
 let path=u.pathname==='/'?'index.html':u.pathname.replace(/^\//,'');path=resolve(UI,path);if(!path.startsWith(UI))return json(res,403,{error:'Forbidden'});try{const s=await stat(path);if(s.isDirectory())path=resolve(path,'index.html');const data=await readFile(path);res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream','cache-control':extname(path)==='.html'?'no-store':'public, max-age=300','x-content-type-options':'nosniff','content-security-policy':"default-src 'self' https://esm.sh; script-src 'self' https://esm.sh; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"});return res.end(data);}catch{return json(res,404,{error:'Not found'});}
 }catch(err){return json(res,err.status||400,{error:err.message,code:err.code||'BAD_REQUEST'});}});
server.listen(PORT,'0.0.0.0',()=>console.log(`Helios Clinical AI Security console listening on http://localhost:${PORT}`));
