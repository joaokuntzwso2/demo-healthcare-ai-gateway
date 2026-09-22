import crypto from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectSensitive } from './redaction.mjs';
const ROOT=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const DEMO_KEY=process.env.HELIOS_KNOWLEDGE_SIGNING_KEY||'helios-demo-only-knowledge-signing-key';
const allowedExt=new Set(['.txt','.md','.json','.csv']);
const approvedPublishers=new Set(['Helios Clinical Governance','Aurora Clinical Governance','Helios Patient Education']);
const injectionPatterns=[/ignore\s+(?:all\s+)?(?:prior|previous)\s+instructions/i,/system\s+prompt/i,/recommend\s+drug\s+y\s+at\s+(?:the\s+)?maximum\s+dose/i,/patient\s+definitely\s+has/i,/override\s+(?:clinical|safety|policy)/i];
const activePatterns=[/<script\b/i,/javascript\s*:/i,/onerror\s*=/i,/data:text\/html/i,/<!ENTITY/i];
let catalog=[];
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const sign=(digest,publisher,version)=>crypto.createHmac('sha256',DEMO_KEY).update(`${digest}|${publisher}|${version}`).digest('hex');

function metadataFor(name){
 const now=new Date();
 const common={specialty:'general',tenant:'helios-north',effectiveDate:'2026-01-01',reviewDate:'2027-01-01',version:'1.0'};
 if(name.includes('medication-review')) return {...common,publisher:'Helios Clinical Governance',trustLevel:'trusted',specialty:'clinical-pharmacy',version:'3.2',tenant:'helios-north'};
 if(name.includes('renal-review')) return {...common,publisher:'Helios Clinical Governance',trustLevel:'trusted',specialty:'nephrology-workflow',version:'1.2',tenant:'helios-north'};
 if(name.includes('anticoagulation-review')) return {...common,publisher:'Helios Clinical Governance',trustLevel:'trusted',specialty:'anticoagulation-workflow',version:'1.1',tenant:'helios-north'};
 if(name.includes('diabetes-followup')) return {...common,publisher:'Helios Clinical Governance',trustLevel:'trusted',specialty:'chronic-care-workflow',version:'1.1',tenant:'helios-north'};
 if(name.includes('discharge-reconciliation')) return {...common,publisher:'Helios Clinical Governance',trustLevel:'trusted',specialty:'transitions-of-care',version:'1.3',tenant:'helios-north'};
 if(name.includes('patient-education')) return {...common,publisher:'Helios Patient Education',trustLevel:'trusted',specialty:'patient-education',version:'2.1',tenant:'helios-north'};
 if(name.includes('stale')) return {...common,publisher:'Helios Clinical Governance',trustLevel:'trusted',reviewDate:'2025-01-01',version:'0.9',tenant:'helios-north'};
 if(name.includes('aurora')) return {...common,publisher:'Aurora Clinical Governance',trustLevel:'trusted',specialty:'general',version:'1.4',tenant:'aurora-br'};
 if(name.includes('referral')) return {...common,publisher:'External Referral Partner',trustLevel:'untrusted-evidence',specialty:'referral',version:'external-1',tenant:'helios-north'};
 if(name.includes('poisoned')) return {...common,publisher:'Unknown Upload',trustLevel:'untrusted',specialty:'unknown',version:'unknown',tenant:'helios-north'};
 return {...common,publisher:'Unknown Upload',trustLevel:'untrusted',tenant:'helios-north'};
}
function inspectContent(content){ const injections=injectionPatterns.filter(r=>r.test(content)).map(r=>r.source); const active=activePatterns.filter(r=>r.test(content)).map(r=>r.source); const dlp=detectSensitive(content); return {injections,active,dlp}; }
function buildDoc(name,content,channel){
 const meta=metadataFor(name); const digest=hash(content); const stale=new Date(meta.reviewDate)<new Date('2026-09-17T00:00:00Z'); const inspection=inspectContent(content);
 const signature=meta.trustLevel==='trusted'?sign(digest,meta.publisher,meta.version):null; const signatureState=signature?'valid-demo-hmac':'unsigned';
 let status='accepted'; const reasons=[];
 if(channel==='untrusted'||meta.trustLevel!=='trusted'){ status=meta.trustLevel==='untrusted-evidence'?'evidence-only':'quarantined'; reasons.push('SOURCE_NOT_TRUSTED'); }
 if(stale){status='quarantined';reasons.push('STALE_SOURCE');}
 if(inspection.injections.length){ if(meta.trustLevel==='untrusted-evidence') status='evidence-only'; else status='quarantined'; reasons.push('INDIRECT_PROMPT_INJECTION'); }
 if(inspection.active.length){status='quarantined';reasons.push('ACTIVE_CONTENT_DETECTED');}
 if(inspection.dlp.length){reasons.push('DLP_FINDING'); if(meta.trustLevel!=='untrusted-evidence') status='quarantined';}
 return {id:`src-${digest.slice(0,12)}`,filename:name,channel,publisher:meta.publisher,trustLevel:meta.trustLevel,effectiveDate:meta.effectiveDate,reviewDate:meta.reviewDate,version:meta.version,specialty:meta.specialty,tenant:meta.tenant,sha256:digest,signatureState,signature,status,reasonCodes:[...new Set(reasons)],content,inspection};
}
export async function initializeKnowledge(){
 catalog=[];
 for(const channel of ['trusted','untrusted']){
  const dir=resolve(ROOT,'demo-files',channel); let names=[]; try{names=await readdir(dir);}catch{}
  for(const name of names){ if(!allowedExt.has(extname(name).toLowerCase())) continue; const content=await readFile(resolve(dir,name),'utf8'); catalog.push(buildDoc(name,content,channel)); }
 }
 detectContradictions(); return catalog;
}
function detectContradictions(){
 // Demo-only deterministic contradiction marker: same topic line prefixed POLICY: with conflicting values.
 const map=new Map();
 for(const d of catalog.filter(x=>x.status==='accepted')){
  for(const m of d.content.matchAll(/^POLICY:\s*([^=\n]+)=\s*([^\n]+)$/gmi)){ const key=`${d.tenant}|${m[1].trim().toLowerCase()}`; const val=m[2].trim().toLowerCase(); if(map.has(key)&&map.get(key).value!==val){d.status='quarantined';d.reasonCodes.push('CONTRADICTION_DETECTED');const other=map.get(key).doc;other.status='quarantined';other.reasonCodes.push('CONTRADICTION_DETECTED');} else map.set(key,{value:val,doc:d}); }
 }
}
export function listKnowledge({tenant}={}){ return catalog.filter(d=>!tenant||d.tenant===tenant).map(({content,signature,...d})=>({...d,contentPreview:content.slice(0,160)})); }
export function getEvidenceDocument(id,context){ const d=catalog.find(x=>x.id===id&&x.tenant===context.tenant); if(!d) return null; return {...d,authority:d.status==='accepted'?'clinical-knowledge-source':'untrusted-evidence',modelInstructionsAreAuthority:false}; }
export function searchKnowledge(context,query,{educationOnly=false}={}){
 const terms=String(query||'').toLowerCase().split(/\W+/).filter(x=>x.length>2); const specialtyFilter=educationOnly?'patient-education':null;
 return catalog.filter(d=>d.tenant===context.tenant&&d.status==='accepted'&&d.trustLevel==='trusted'&&(!specialtyFilter||d.specialty===specialtyFilter)).map(d=>{const body=d.content.toLowerCase();const score=terms.reduce((n,t)=>n+(body.includes(t)?1:0),0);return {d,score};}).filter(x=>x.score>0||!terms.length).sort((a,b)=>b.score-a.score).slice(0,4).map(({d,score})=>({sourceId:d.id,title:d.filename,publisher:d.publisher,version:d.version,effectiveDate:d.effectiveDate,reviewDate:d.reviewDate,sha256:d.sha256,signatureState:d.signatureState,trustLevel:d.trustLevel,score,excerpt:d.content.slice(0,600),evidenceType:'CLINICAL KNOWLEDGE SOURCE'}));
}
export function ingestDocument({filename='upload.txt',content='',channel='untrusted',tenant='helios-north',publisher='Unknown Upload',version='upload-1',reviewDate='2027-01-01',specialty='general'}={}){
 if(!allowedExt.has(extname(filename).toLowerCase())) return {status:415,body:{decision:'REJECTED',reasonCodes:['FILE_TYPE_NOT_ALLOWED']}};
 const bytes=Buffer.byteLength(content); if(bytes>1024*1024) return {status:413,body:{decision:'REJECTED',reasonCodes:['FILE_TOO_LARGE']}};
 if(content.includes('\u0000')) return {status:422,body:{decision:'REJECTED',reasonCodes:['BINARY_OR_INVALID_TEXT']}};
 let d=buildDoc(filename,content,channel); d={...d,tenant,publisher,version,reviewDate};
 const digest=hash(content); d.sha256=digest; if(channel==='trusted'&&approvedPublishers.has(publisher)){d.trustLevel='trusted';d.signature=sign(digest,publisher,version);d.signatureState='valid-demo-hmac';d.status=new Date(reviewDate)<new Date('2026-09-17')?'quarantined':'accepted';d.reasonCodes=d.status==='accepted'?[]:['STALE_SOURCE'];} else if(channel==='trusted'){d.status='quarantined';d.reasonCodes=[...new Set([...d.reasonCodes,'PUBLISHER_NOT_APPROVED'])];}
 const inspection=inspectContent(content); d.inspection=inspection; if(inspection.active.length||inspection.injections.length){d.status=channel==='untrusted'?'evidence-only':'quarantined';d.reasonCodes=[...new Set([...d.reasonCodes,...(inspection.active.length?['ACTIVE_CONTENT_DETECTED']:[]),...(inspection.injections.length?['INDIRECT_PROMPT_INJECTION']:[])])];}
 catalog.unshift(d); detectContradictions(); return {status:d.status==='accepted'?201:202,body:{decision:d.status.toUpperCase().replace('-','_'),sourceId:d.id,sha256:d.sha256,signatureState:d.signatureState,reasonCodes:d.reasonCodes,authority:d.status==='accepted'?'trusted-knowledge':'untrusted-evidence'}};
}
export function verifySource(id){ const d=catalog.find(x=>x.id===id); if(!d)return {valid:false,reason:'NOT_FOUND'}; if(!d.signature)return {valid:false,reason:'UNSIGNED'}; return {valid:crypto.timingSafeEqual(Buffer.from(d.signature),Buffer.from(sign(d.sha256,d.publisher,d.version))),reason:'DEMO_HMAC_ONLY'}; }
