import crypto from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectSensitive } from './redaction.mjs';

const ROOT=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const DEMO_KEY=process.env.HELIOS_KNOWLEDGE_SIGNING_KEY||'helios-demo-only-knowledge-signing-key';
const GATEWAY_PROVENANCE_KEY=process.env.HELIOS_CONTEXT_SIGNING_KEY||process.env.HELIOS_KNOWLEDGE_GATEWAY_SIGNING_KEY||'helios-demo-only-context-signing-key';
const DEMO_AS_OF=new Date(process.env.HELIOS_KNOWLEDGE_AS_OF||'2026-09-25T00:00:00Z');
const allowedExt=new Set(['.txt','.md','.json','.csv']);
const approvedPublishers=new Set(['Helios Clinical Governance','Aurora Clinical Governance','Helios Patient Education']);
const injectionPatterns=[
 /ignore\s+(?:all\s+)?(?:prior|previous)\s+instructions/i,
 /system\s+prompt/i,
 /recommend\s+drug\s+y\s+at\s+(?:the\s+)?maximum\s+dose/i,
 /patient\s+definitely\s+has/i,
 /override\s+(?:clinical|safety|policy)/i,
 /do\s+not\s+ask\s+for\s+clinician\s+approval/i
];
const activePatterns=[/<script\b/i,/javascript\s*:/i,/onerror\s*=/i,/data:text\/html/i,/<!ENTITY/i];

export const KNOWLEDGE_TRUST={
 TRUSTED_GOVERNED:'TRUSTED_GOVERNED',
 UNTRUSTED_EXTERNAL_EVIDENCE:'UNTRUSTED_EXTERNAL_EVIDENCE',
 UNTRUSTED_UPLOAD:'UNTRUSTED_UPLOAD'
};

export const KNOWLEDGE_LIFECYCLE={
 ACTIVE:'ACTIVE',
 STALE:'STALE',
 EVIDENCE_ONLY:'EVIDENCE_ONLY',
 QUARANTINED:'QUARANTINED'
};

let catalog=[];

const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const sign=(digest,publisher,version)=>crypto.createHmac('sha256',DEMO_KEY).update(`${digest}|${publisher}|${version}`).digest('hex');
const uniq=x=>[...new Set(x)];
const gatewayProofPayload=d=>[d.id,d.sha256,d.publisher,d.version,d.lifecycleState,d.trustClassification,String(Boolean(d.eligibleForRetrieval))].join('|');
const gatewayProofFor=d=>{const payload=gatewayProofPayload(d);const encoded=Buffer.from(payload,'utf8').toString('base64url');const mac=crypto.createHmac('sha256',GATEWAY_PROVENANCE_KEY).update(payload).digest('hex');return `${encoded}.${mac}`;};
function refreshGatewayProof(d){
 if(!d)return d;
 d.knowledgeProof=gatewayProofFor(d);
 if(d.provenance){
  d.provenance.knowledgeProofState='signed-hmac-sha256';
  d.provenance.knowledgeProof=d.knowledgeProof;
 }
 return d;
}

function metadataFor(name){
 const common={
  specialty:'general',
  tenant:'helios-north',
  effectiveDate:'2026-01-01',
  reviewDate:'2027-01-01',
  version:'1.0',
  knowledgeKey:null,
  supersedes:null,
  supersededBy:null,
  ingestedAt:'2026-09-25T08:00:00Z'
 };

 if(name==='clinical-guideline-renal-v3-active.md')return {
  ...common,
  publisher:'Helios Clinical Governance',
  trustLevel:'trusted',
  specialty:'nephrology-workflow',
  effectiveDate:'2026-07-01',
  reviewDate:'2027-07-01',
  version:'3.0',
  knowledgeKey:'renal-medication-guideline',
  supersedes:'2.0'
 };

 if(name==='clinical-guideline-renal-v2-stale.md')return {
  ...common,
  publisher:'Helios Clinical Governance',
  trustLevel:'trusted',
  specialty:'nephrology-workflow',
  effectiveDate:'2025-07-01',
  reviewDate:'2026-06-30',
  version:'2.0',
  knowledgeKey:'renal-medication-guideline',
  supersededBy:'3.0',
  ingestedAt:'2025-07-01T08:00:00Z'
 };

 if(name==='referral-malicious-instructions.md')return {
  ...common,
  publisher:'External Referral Partner',
  trustLevel:'untrusted-evidence',
  specialty:'referral',
  version:'external-1',
  knowledgeKey:'external-referral',
  effectiveDate:'2026-09-24',
  reviewDate:'2026-10-24',
  ingestedAt:'2026-09-24T14:30:00Z'
 };

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

function inspectContent(content){
 const injections=injectionPatterns.filter(r=>r.test(content)).map(r=>r.source);
 const active=activePatterns.filter(r=>r.test(content)).map(r=>r.source);
 const dlp=detectSensitive(content);
 return {injections,active,dlp};
}

function trustClassification(meta){
 if(meta.trustLevel==='trusted')return KNOWLEDGE_TRUST.TRUSTED_GOVERNED;
 if(meta.trustLevel==='untrusted-evidence')return KNOWLEDGE_TRUST.UNTRUSTED_EXTERNAL_EVIDENCE;
 return KNOWLEDGE_TRUST.UNTRUSTED_UPLOAD;
}

function lifecycleFrom({meta,stale,inspection,status}){
 if(inspection.active.length||inspection.injections.length)return KNOWLEDGE_LIFECYCLE.QUARANTINED;
 if(stale)return KNOWLEDGE_LIFECYCLE.STALE;
 if(status==='accepted'&&meta.trustLevel==='trusted')return KNOWLEDGE_LIFECYCLE.ACTIVE;
 if(status==='evidence-only')return KNOWLEDGE_LIFECYCLE.EVIDENCE_ONLY;
 return KNOWLEDGE_LIFECYCLE.QUARANTINED;
}

function attachGovernance(d,meta){
 const lifecycleState=lifecycleFrom({
  meta,
  stale:d.reasonCodes.includes('STALE_SOURCE')||d.reasonCodes.includes('SUPERSEDED_VERSION'),
  inspection:d.inspection,
  status:d.status
 });
 const trust=trustClassification(meta);
 const eligibleForRetrieval=
  lifecycleState===KNOWLEDGE_LIFECYCLE.ACTIVE&&
  trust===KNOWLEDGE_TRUST.TRUSTED_GOVERNED&&
  d.signatureState==='valid-demo-hmac';

 const out={
  ...d,
  lifecycleState,
  trustClassification:trust,
  eligibleForRetrieval,
  provenance:{
   sourceId:d.id,
   publisher:d.publisher,
   version:d.version,
   tenant:d.tenant,
   specialty:d.specialty,
   effectiveDate:d.effectiveDate,
   reviewDate:d.reviewDate,
   ingestedAt:meta.ingestedAt,
   sha256:d.sha256,
   signatureState:d.signatureState,
   channel:d.channel,
   knowledgeKey:meta.knowledgeKey,
   supersedes:meta.supersedes,
   supersededBy:meta.supersededBy
  }
 };
 return refreshGatewayProof(out);
}

function buildDoc(name,content,channel){
 const meta=metadataFor(name);
 const digest=hash(content);
 const stale=new Date(meta.reviewDate)<DEMO_AS_OF;
 const inspection=inspectContent(content);
 const signature=meta.trustLevel==='trusted'?sign(digest,meta.publisher,meta.version):null;
 const signatureState=signature?'valid-demo-hmac':'unsigned';
 let status='accepted';
 const reasons=[];

 if(channel==='untrusted'||meta.trustLevel!=='trusted'){
  status=meta.trustLevel==='untrusted-evidence'?'evidence-only':'quarantined';
  reasons.push('SOURCE_NOT_TRUSTED');
 }
 if(stale){
  status='quarantined';
  reasons.push('STALE_SOURCE');
 }
 if(inspection.injections.length){
  status=meta.trustLevel==='untrusted-evidence'?'evidence-only':'quarantined';
  reasons.push('INDIRECT_PROMPT_INJECTION');
 }
 if(inspection.active.length){
  status='quarantined';
  reasons.push('ACTIVE_CONTENT_DETECTED');
 }
 if(inspection.dlp.length){
  reasons.push('DLP_FINDING');
  if(meta.trustLevel!=='untrusted-evidence')status='quarantined';
 }

 const base={
  id:`src-${digest.slice(0,12)}`,
  filename:name,
  channel,
  publisher:meta.publisher,
  trustLevel:meta.trustLevel,
  effectiveDate:meta.effectiveDate,
  reviewDate:meta.reviewDate,
  version:meta.version,
  specialty:meta.specialty,
  tenant:meta.tenant,
  sha256:digest,
  signatureState,
  signature,
  status,
  reasonCodes:uniq(reasons),
  content,
  inspection
 };
 return attachGovernance(base,meta);
}

function versionNumber(v){
 const m=String(v||'').match(/^\d+(?:\.\d+)?/);
 return m?Number(m[0]):-1;
}

function applyLifecycleSupersession(){
 const groups=new Map();
 for(const d of catalog){
  const key=d.provenance?.knowledgeKey;
  if(!key||d.trustClassification!==KNOWLEDGE_TRUST.TRUSTED_GOVERNED)continue;
  const k=`${d.tenant}|${key}`;
  if(!groups.has(k))groups.set(k,[]);
  groups.get(k).push(d);
 }

 for(const docs of groups.values()){
  const current=docs
   .filter(d=>d.lifecycleState===KNOWLEDGE_LIFECYCLE.ACTIVE)
   .sort((a,b)=>versionNumber(b.version)-versionNumber(a.version))[0];

  if(!current)continue;

  for(const d of docs){
   if(d.id===current.id)continue;
   if(versionNumber(d.version)<versionNumber(current.version)){
    d.lifecycleState=KNOWLEDGE_LIFECYCLE.STALE;
    d.status='quarantined';
    d.eligibleForRetrieval=false;
    d.reasonCodes=uniq([...d.reasonCodes,'SUPERSEDED_VERSION']);
    d.provenance.supersededBy=current.version;
    if(!current.provenance.supersedes)current.provenance.supersedes=d.version;
   }
  }
 }
 for(const d of catalog)refreshGatewayProof(d);
}

function detectContradictions(){
 const map=new Map();
 for(const d of catalog.filter(x=>x.eligibleForRetrieval)){
  for(const m of d.content.matchAll(/^POLICY:\s*([^=\n]+)=\s*([^\n]+)$/gmi)){
   const key=`${d.tenant}|${m[1].trim().toLowerCase()}`;
   const val=m[2].trim().toLowerCase();

   if(map.has(key)&&map.get(key).value!==val){
    d.status='quarantined';
    d.lifecycleState=KNOWLEDGE_LIFECYCLE.QUARANTINED;
    d.eligibleForRetrieval=false;
    d.reasonCodes=uniq([...d.reasonCodes,'CONTRADICTION_DETECTED']);

    const other=map.get(key).doc;
    other.status='quarantined';
    other.lifecycleState=KNOWLEDGE_LIFECYCLE.QUARANTINED;
    other.eligibleForRetrieval=false;
    other.reasonCodes=uniq([...other.reasonCodes,'CONTRADICTION_DETECTED']);
   }else{
    map.set(key,{value:val,doc:d});
   }
  }
 }
 for(const d of catalog)refreshGatewayProof(d);
}

export async function initializeKnowledge(){
 catalog=[];

 for(const channel of ['trusted','untrusted']){
  const dir=resolve(ROOT,'demo-files',channel);
  let names=[];
  try{names=await readdir(dir);}catch{}

  for(const name of names){
   if(!allowedExt.has(extname(name).toLowerCase()))continue;
   const content=await readFile(resolve(dir,name),'utf8');
   catalog.push(buildDoc(name,content,channel));
  }
 }

 applyLifecycleSupersession();
 detectContradictions();
 return catalog;
}

function publicDocument(d,{preview=true}={}){
 const {content,signature,inspection,...rest}=d;
 return {
  ...rest,
  ...(preview?{
   contentPreview:d.lifecycleState===KNOWLEDGE_LIFECYCLE.QUARANTINED
    ?'[QUARANTINED CONTENT NOT EXPOSED]'
    :content.slice(0,160)
  }:{})
 };
}

export function listKnowledge({tenant}={}){
 return catalog
  .filter(d=>!tenant||d.tenant===tenant)
  .map(d=>publicDocument(d));
}

export function getEvidenceDocument(id,context){
 const d=catalog.find(x=>x.id===id&&x.tenant===context.tenant);
 if(!d)return null;

 // Preserve the internal evidence API contract, including document content,
 // while lifecycle/demo projections deliberately redact quarantined content.
 return {
  ...d,
  authority:d.eligibleForRetrieval?'clinical-knowledge-source':'non-authoritative-evidence',
  modelInstructionsAreAuthority:false
 };
}

export function searchKnowledge(context,query,{educationOnly=false}={}){
 const terms=String(query||'').toLowerCase().split(/\W+/).filter(x=>x.length>2);
 const specialtyFilter=educationOnly?'patient-education':null;

 return catalog
  .filter(d=>
   d.tenant===context.tenant&&
   d.eligibleForRetrieval&&
   d.lifecycleState===KNOWLEDGE_LIFECYCLE.ACTIVE&&
   d.trustClassification===KNOWLEDGE_TRUST.TRUSTED_GOVERNED&&
   (!specialtyFilter||d.specialty===specialtyFilter)
  )
  .map(d=>{
   const body=d.content.toLowerCase();
   const score=terms.reduce((n,t)=>n+(body.includes(t)?1:0),0);
   return {d,score};
  })
  .filter(x=>x.score>0||!terms.length)
  .sort((a,b)=>b.score-a.score||versionNumber(b.d.version)-versionNumber(a.d.version))
  .slice(0,4)
  .map(({d,score})=>({
   sourceId:d.id,
   title:d.filename,
   publisher:d.publisher,
   version:d.version,
   effectiveDate:d.effectiveDate,
   reviewDate:d.reviewDate,
   sha256:d.sha256,
   signatureState:d.signatureState,
   trustLevel:d.trustLevel,
   trustClassification:d.trustClassification,
   lifecycleState:d.lifecycleState,
   eligibleForRetrieval:d.eligibleForRetrieval,
   provenance:d.provenance,
   knowledgeProof:d.knowledgeProof,
   score,
   excerpt:d.content.slice(0,600),
   evidenceType:'CLINICAL KNOWLEDGE SOURCE'
  }));
}

export function ingestDocument({
 filename='upload.txt',
 content='',
 channel='untrusted',
 tenant='helios-north',
 publisher='Unknown Upload',
 version='upload-1',
 reviewDate='2027-01-01',
 specialty='general'
}={}){
 if(!allowedExt.has(extname(filename).toLowerCase())){
  return {status:415,body:{decision:'REJECTED',reasonCodes:['FILE_TYPE_NOT_ALLOWED']}};
 }

 const bytes=Buffer.byteLength(content);
 if(bytes>1024*1024){
  return {status:413,body:{decision:'REJECTED',reasonCodes:['FILE_TOO_LARGE']}};
 }

 if(content.includes('\u0000')){
  return {status:422,body:{decision:'REJECTED',reasonCodes:['BINARY_OR_INVALID_TEXT']}};
 }

 let d=buildDoc(filename,content,channel);
 d={...d,tenant,publisher,version,reviewDate};

 const digest=hash(content);
 d.sha256=digest;

 const approved=channel==='trusted'&&approvedPublishers.has(publisher);

 if(approved){
  d.trustLevel='trusted';
  d.trustClassification=KNOWLEDGE_TRUST.TRUSTED_GOVERNED;
  d.signature=sign(digest,publisher,version);
  d.signatureState='valid-demo-hmac';
  d.status=new Date(reviewDate)<DEMO_AS_OF?'quarantined':'accepted';
  d.lifecycleState=d.status==='accepted'?KNOWLEDGE_LIFECYCLE.ACTIVE:KNOWLEDGE_LIFECYCLE.STALE;
  d.reasonCodes=d.status==='accepted'?[]:['STALE_SOURCE'];
 }else if(channel==='trusted'){
  d.status='quarantined';
  d.lifecycleState=KNOWLEDGE_LIFECYCLE.QUARANTINED;
  d.trustClassification=KNOWLEDGE_TRUST.UNTRUSTED_UPLOAD;
  d.reasonCodes=uniq([...d.reasonCodes,'PUBLISHER_NOT_APPROVED']);
 }

 const inspection=inspectContent(content);
 d.inspection=inspection;

 if(inspection.active.length||inspection.injections.length){
  d.status=channel==='untrusted'?'evidence-only':'quarantined';
  d.lifecycleState=KNOWLEDGE_LIFECYCLE.QUARANTINED;
  d.reasonCodes=uniq([
   ...d.reasonCodes,
   ...(inspection.active.length?['ACTIVE_CONTENT_DETECTED']:[]),
   ...(inspection.injections.length?['INDIRECT_PROMPT_INJECTION']:[])
  ]);
 }

 d.eligibleForRetrieval=
  d.status==='accepted'&&
  d.lifecycleState===KNOWLEDGE_LIFECYCLE.ACTIVE&&
  d.trustClassification===KNOWLEDGE_TRUST.TRUSTED_GOVERNED&&
  d.signatureState==='valid-demo-hmac';

 d.provenance={
  sourceId:d.id,
  publisher:d.publisher,
  version:d.version,
  tenant:d.tenant,
  specialty:d.specialty,
  effectiveDate:d.effectiveDate,
  reviewDate:d.reviewDate,
  ingestedAt:'2026-09-25T09:00:00Z',
  sha256:d.sha256,
  signatureState:d.signatureState,
  channel:d.channel,
  knowledgeKey:null,
  supersedes:null,
  supersededBy:null
 };
 refreshGatewayProof(d);

 catalog.unshift(d);
 applyLifecycleSupersession();
 detectContradictions();

 return {
  status:d.status==='accepted'?201:202,
  body:{
   decision:d.lifecycleState,
   sourceId:d.id,
   sha256:d.sha256,
   signatureState:d.signatureState,
   trustClassification:d.trustClassification,
   lifecycleState:d.lifecycleState,
   eligibleForRetrieval:d.eligibleForRetrieval,
   reasonCodes:d.reasonCodes,
   provenance:d.provenance,
   knowledgeProof:d.knowledgeProof,
   authority:d.eligibleForRetrieval?'trusted-knowledge':'non-authoritative-evidence'
  }
 };
}

export function verifySource(id){
 const d=catalog.find(x=>x.id===id);
 if(!d)return {valid:false,reason:'NOT_FOUND'};
 if(!d.signature){
  return {
   valid:false,
   reason:'UNSIGNED',
   lifecycleState:d.lifecycleState,
   trustClassification:d.trustClassification,
   eligibleForRetrieval:d.eligibleForRetrieval
  };
 }

 const contentSignatureValid=crypto.timingSafeEqual(
  Buffer.from(d.signature),
  Buffer.from(sign(d.sha256,d.publisher,d.version))
 );
 const gatewayProofValid=d.knowledgeProof===gatewayProofFor(d);
 return {
  valid:contentSignatureValid&&gatewayProofValid,
  contentSignatureValid,
  gatewayProofValid,
  reason:'DEMO_HMAC_AND_GATEWAY_PROVENANCE_HMAC',
  lifecycleState:d.lifecycleState,
  trustClassification:d.trustClassification,
  eligibleForRetrieval:d.eligibleForRetrieval
 };
}
