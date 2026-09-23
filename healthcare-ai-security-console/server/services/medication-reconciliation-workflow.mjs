import crypto from 'node:crypto';
import { patients, workforce } from '../data/synthetic-healthcare.mjs';
import { resolveClinicianContext, AccessError } from './context.mjs';
import { invokeModel, gatewayConfig } from './gateway-client.mjs';

const DEFAULT_PATIENT_ID='pat-1001';
const DEFAULT_ACTOR_ID='neph-001';

const sessions=new Map();
const auditEvents=[];

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function id(prefix){return `${prefix}-${crypto.randomUUID()}`;}
function iso(){return new Date().toISOString();}
function fail(code,message,status=400){throw Object.assign(new Error(message),{code,status});}
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}

const SOURCE_ORDER=['EHR_MEDICATION_LIST','PATIENT_REPORTED_MEDICATIONS','DISCHARGE_INSTRUCTIONS'];

const sourceMetadata={
  EHR_MEDICATION_LIST:{
    sourceId:'EHR_MEDICATION_LIST',
    sourceDisplay:'EHR Medication List',
    sourceClass:'institutional-medication-record',
    sourceSystem:'EHR-MEDICATIONS',
    recordedAt:'2026-09-17T08:10:00Z'
  },
  PATIENT_REPORTED_MEDICATIONS:{
    sourceId:'PATIENT_REPORTED_MEDICATIONS',
    sourceDisplay:'Patient-reported Medications',
    sourceClass:'patient-reported-evidence',
    sourceSystem:'POST-DISCHARGE-MED-INTERVIEW',
    recordedAt:'2026-09-18T10:15:00Z'
  },
  DISCHARGE_INSTRUCTIONS:{
    sourceId:'DISCHARGE_INSTRUCTIONS',
    sourceDisplay:'Discharge Medication Instructions',
    sourceClass:'institutional-discharge-instruction',
    sourceSystem:'EHR-DISCHARGE-INSTRUCTIONS',
    recordedAt:'2026-09-17T16:40:00Z'
  }
};

const medicationSourceSnapshot=[
  {
    medicationKey:'lisinopril',
    medicationDisplay:'Lisinopril',
    claims:[
      {
        ...sourceMetadata.EHR_MEDICATION_LIST,
        status:'active',
        dose:{value:10,unit:'mg'},
        route:'oral',
        frequency:'daily',
        provenance:'Medication list present in the synthetic EHR before discharge reconciliation.'
      },
      {
        ...sourceMetadata.PATIENT_REPORTED_MEDICATIONS,
        status:'taking',
        dose:{value:10,unit:'mg'},
        route:'oral',
        frequency:'twice daily',
        provenance:'Synthetic patient report collected during post-discharge medication interview.'
      },
      {
        ...sourceMetadata.DISCHARGE_INSTRUCTIONS,
        status:'instructed',
        dose:{value:20,unit:'mg'},
        route:'oral',
        frequency:'daily',
        provenance:'Synthetic discharge medication instruction.'
      }
    ]
  },
  {
    medicationKey:'furosemide',
    medicationDisplay:'Furosemide',
    claims:[
      {
        ...sourceMetadata.EHR_MEDICATION_LIST,
        status:'active',
        dose:{value:20,unit:'mg'},
        route:'oral',
        frequency:'daily',
        provenance:'Medication list present in the synthetic EHR before discharge reconciliation.'
      },
      {
        ...sourceMetadata.PATIENT_REPORTED_MEDICATIONS,
        status:'not-taking',
        dose:null,
        route:'oral',
        frequency:null,
        provenance:'Synthetic patient reports not taking this medication after discharge.'
      },
      {
        ...sourceMetadata.DISCHARGE_INSTRUCTIONS,
        status:'instructed',
        dose:{value:40,unit:'mg'},
        route:'oral',
        frequency:'daily',
        provenance:'Synthetic discharge medication instruction.'
      }
    ]
  }
];

function claimSignature(claim){
  return JSON.stringify({
    status:claim.status||null,
    dose:claim.dose||null,
    route:claim.route||null,
    frequency:claim.frequency||null
  });
}

function differingFields(claims){
  const fields=['status','dose','route','frequency'];
  return fields.filter(field=>{
    const values=claims.map(c=>JSON.stringify(c[field]??null));
    return new Set(values).size>1;
  });
}

function normalizedMedicationLines(){
  return medicationSourceSnapshot.map(item=>{
    const claims=SOURCE_ORDER.map(sourceId=>item.claims.find(c=>c.sourceId===sourceId)).filter(Boolean);
    const signatures=new Set(claims.map(claimSignature));
    return {
      medicationKey:item.medicationKey,
      medicationDisplay:item.medicationDisplay,
      reconciliationState:signatures.size>1?'UNRESOLVED':'CONSISTENT',
      authoritativeWinner:null,
      differingFields:differingFields(claims),
      claims:clone(claims)
    };
  });
}

function sourceSnapshot(){
  const lines=normalizedMedicationLines();
  const snapshot={
    workflowType:'POST_DISCHARGE_MEDICATION_RECONCILIATION',
    sourceOrder:[...SOURCE_ORDER],
    lines,
    policy:{
      silentResolutionAllowed:false,
      recencyAloneMaySelectWinner:false,
      modelMaySelectAuthoritativeWinner:false,
      patientReportIsEvidenceNotAutomaticAuthority:true,
      humanResolutionRequired:true
    }
  };
  return {...snapshot,snapshotHash:hash(snapshot)};
}

function latestSession(actorId,patientId){
  return [...sessions.values()]
    .filter(x=>x.actorId===actorId&&x.patientId===patientId)
    .sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0]||null;
}

function audit(type,{session,actor,details=null}={}){
  const patient=session?patients[session.patientId]:null;
  const authority=
    type==='AI_RECONCILIATION_DRAFT_CREATED'?'AI_ASSISTED':
    (type==='HUMAN_MED_REC_RECONCILED'||type==='HUMAN_MED_REC_PARTIALLY_RECONCILED')?'HUMAN':
    'SYSTEM';

  const event={
    eventId:id('medrec-audit'),
    type,
    authority,
    at:iso(),
    sessionId:session?.sessionId||null,
    actorId:actor?.id||null,
    actorDisplay:actor?.display||null,
    patientPseudonym:patient?.pseudonym||null,
    workflow:'MEDICATION_RECONCILIATION',
    snapshotHash:session?.evidence?.snapshotHash||null,
    chartWritten:false,
    orderCreated:false,
    details
  };

  auditEvents.unshift(event);
  if(auditEvents.length>300)auditEvents.length=300;
  return event;
}

function safeDraft(value=''){
  return String(value||'')
    .replace(/\b(?:pat|portal|hosp|cardio|clin|nurse|care|neph|endo|pharm|er)-\d+\b/gi,'[internal-id-redacted]')
    .replace(/\bHN-P-[A-Z0-9-]+\b/gi,'[patient-pseudonym-redacted]')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,1800);
}

function compactClaim(claim){
  return {
    sourceId:claim.sourceId,
    sourceDisplay:claim.sourceDisplay,
    sourceClass:claim.sourceClass,
    recordedAt:claim.recordedAt,
    status:claim.status,
    dose:claim.dose,
    route:claim.route,
    frequency:claim.frequency
  };
}

function modelEvidencePayload(evidence){
  return evidence.lines.map(line=>({
    medicationKey:line.medicationKey,
    medicationDisplay:line.medicationDisplay,
    reconciliationState:line.reconciliationState,
    differingFields:line.differingFields,
    claims:line.claims.map(compactClaim)
  }));
}

function publicSession(session){
  if(!session)return null;
  const actor=workforce[session.actorId];
  const patient=patients[session.patientId];

  return {
    sessionId:session.sessionId,
    workflowType:session.workflowType,
    status:session.status,
    createdAt:session.createdAt,
    actor:{
      id:actor?.id||session.actorId,
      display:actor?.display||session.actorId,
      role:actor?.role||null,
      specialty:actor?.specialty||null
    },
    patient:{
      display:patient?.name||'Synthetic patient',
      pseudonym:patient?.pseudonym||null
    },
    postDischargeContext:clone(session.postDischargeContext),
    evidence:clone(session.evidence),
    aiReview:clone(session.aiReview),
    humanReview:clone(session.humanReview),
    outcome:clone(session.outcome)
  };
}

function buildBaseSession({actorId,patientId,aiReview}){
  const evidence=sourceSnapshot();

  return {
    sessionId:id('medrec'),
    workflowType:'POST_DISCHARGE_MEDICATION_RECONCILIATION',
    actorId,
    patientId,
    createdAt:iso(),
    status:'PENDING_HUMAN_RECONCILIATION',
    postDischargeContext:{
      setting:'post-discharge',
      workflow:'medication-reconciliation',
      sourceCount:3,
      medicationCount:evidence.lines.length,
      conflictCount:evidence.lines.filter(x=>x.reconciliationState==='UNRESOLVED').length
    },
    evidence,
    aiReview,
    humanReview:{
      required:true,
      status:'PENDING',
      reviewerActorId:null,
      reviewerDisplay:null,
      reviewedAt:null,
      comment:null,
      decisions:[],
      evidenceSnapshotHash:evidence.snapshotHash
    },
    outcome:{
      reconciledMedicationListAuthoritative:false,
      ehrWritebackSupported:false,
      ehrWritten:false,
      prescriptionChanged:false,
      orderCreated:false,
      destination:null,
      reason:'This synthetic demo records reconciliation decisions only; it does not write to an EHR, change a prescription, or create an order.'
    }
  };
}

export function medicationReconciliationEvidence(patientId=DEFAULT_PATIENT_ID){
  const patient=patients[patientId];
  if(!patient)return null;

  const evidence=sourceSnapshot();
  return {
    patient:{display:patient.name,pseudonym:patient.pseudonym},
    postDischarge:true,
    evidenceType:'MULTI_SOURCE_MEDICATION_RECONCILIATION',
    evidence,
    advisoryCodes:[
      'MEDICATION_RECONCILIATION_REQUIRED',
      'CLINICAL_EVIDENCE_CONFLICT'
    ]
  };
}

export async function startMedicationReconciliation({
  actorId=DEFAULT_ACTOR_ID,
  patientId=DEFAULT_PATIENT_ID
}={}){
  const existing=latestSession(actorId,patientId);
  if(existing?.status==='PENDING_HUMAN_RECONCILIATION')return publicSession(existing);

  const context=resolveClinicianContext({
    actorId,
    patientId,
    encounterId:null,
    purpose:'medication-review'
  });

  if(!context.scopes.includes('medications:read')){
    throw new AccessError('CLINICAL_DATA_NOT_AUTHORIZED','Medication review requires medications:read.',403);
  }

  const evidence=sourceSnapshot();

  const system=[
    'You are a bounded medication-reconciliation assistant in a fully synthetic healthcare demonstration.',
    'You do not own the medication list and you cannot select an authoritative medication regimen.',
    'Compare the three provided source classes: EHR medication list, patient-reported medications, and discharge instructions.',
    'Explain the discrepancies and what a clinician should verify.',
    'Do not declare any source correct.',
    'Do not state a final current dose.',
    'Do not prescribe, discontinue, change, or execute a medication order.',
    'Your output is a non-authoritative draft for clinician reconciliation.'
  ].join(' ');

  const user=[
    'Review this synthetic post-discharge medication reconciliation snapshot.',
    'Identify the mismatches by medication and explain why human reconciliation is required.',
    'Do not choose a winner.',
    JSON.stringify(modelEvidencePayload(evidence))
  ].join('\n');

  const model=await invokeModel({
    context,
    messages:[
      {role:'system',content:system},
      {role:'user',content:user}
    ],
    maxTokens:500,
    temperature:0
  });

  if(model.status>=400){
    fail(
      'AI_RECONCILIATION_GATEWAY_FAILED',
      `WSO2 AI Gateway did not return the medication-reconciliation draft (HTTP ${model.status}).`,
      502
    );
  }

  const draft=model.mode==='deterministic'
    ? 'Synthetic medication reconciliation draft: the EHR medication list, patient-reported medications, and discharge instructions disagree for the listed medications. No source has been selected as authoritative. Human reconciliation is required.'
    : safeDraft(model.message?.content??model.content??'');

  const session=buildBaseSession({
    actorId,
    patientId,
    aiReview:{
      contribution:'DISCREPANCY_SYNTHESIS',
      model:model.model,
      proxy:model.proxy||gatewayConfig().clinicianProxy,
      mode:model.mode,
      draft,
      authority:false,
      maySelectWinner:false,
      evidenceSnapshotHash:evidence.snapshotHash
    }
  });

  sessions.set(session.sessionId,session);

  audit('MED_REC_SOURCE_SNAPSHOT_ASSEMBLED',{
    session,
    actor:context.actor,
    details:{
      sourceIds:[...SOURCE_ORDER],
      medicationCount:evidence.lines.length,
      conflictCount:evidence.lines.filter(x=>x.reconciliationState==='UNRESOLVED').length,
      silentResolutionAllowed:false
    }
  });

  audit('AI_RECONCILIATION_DRAFT_CREATED',{
    session,
    actor:context.actor,
    details:{
      model:session.aiReview.model,
      proxy:session.aiReview.proxy,
      authority:false,
      maySelectWinner:false
    }
  });

  audit('HUMAN_RECONCILIATION_REQUIRED',{
    session,
    actor:context.actor,
    details:{
      required:true,
      unresolvedMedicationKeys:evidence.lines
        .filter(x=>x.reconciliationState==='UNRESOLVED')
        .map(x=>x.medicationKey)
    }
  });

  return publicSession(session);
}

function decisionForLine(line,decision){
  const action=String(decision?.resolution||'').trim().toUpperCase();
  const allowed=['USE_EHR','USE_PATIENT_REPORTED','USE_DISCHARGE','DEFER_CLARIFICATION'];

  if(!allowed.includes(action)){
    fail(
      'INVALID_MEDICATION_RECONCILIATION_DECISION',
      `Medication ${line.medicationDisplay} requires one of: ${allowed.join(', ')}.`,
      400
    );
  }

  if(action==='DEFER_CLARIFICATION'){
    return {
      medicationKey:line.medicationKey,
      medicationDisplay:line.medicationDisplay,
      resolution:action,
      state:'DEFERRED',
      selectedSourceId:null,
      reconciledClaim:null,
      authoritativeBy:'HUMAN_REVIEW',
      rationale:String(decision?.rationale||'').trim().slice(0,500)||null
    };
  }

  const sourceId={
    USE_EHR:'EHR_MEDICATION_LIST',
    USE_PATIENT_REPORTED:'PATIENT_REPORTED_MEDICATIONS',
    USE_DISCHARGE:'DISCHARGE_INSTRUCTIONS'
  }[action];

  const claim=line.claims.find(x=>x.sourceId===sourceId);
  if(!claim)fail('MEDICATION_SOURCE_CLAIM_NOT_FOUND',`Source ${sourceId} is unavailable for ${line.medicationDisplay}.`,409);

  return {
    medicationKey:line.medicationKey,
    medicationDisplay:line.medicationDisplay,
    resolution:action,
    state:'RESOLVED',
    selectedSourceId:sourceId,
    reconciledClaim:compactClaim(claim),
    authoritativeBy:'HUMAN_REVIEW',
    rationale:String(decision?.rationale||'').trim().slice(0,500)||null
  };
}

export function submitMedicationReconciliation({
  sessionId,
  reviewerActorId=DEFAULT_ACTOR_ID,
  decisions=[],
  comment=''
}={}){
  const session=sessions.get(sessionId);
  if(!session)fail('MEDICATION_RECONCILIATION_SESSION_NOT_FOUND','Unknown medication reconciliation session.',404);

  if(session.status!=='PENDING_HUMAN_RECONCILIATION'){
    fail('MEDICATION_RECONCILIATION_ALREADY_COMPLETED','This reconciliation session already has a final human decision.',409);
  }

  const context=resolveClinicianContext({
    actorId:reviewerActorId,
    patientId:session.patientId,
    encounterId:null,
    purpose:'medication-review'
  });

  if(!context.scopes.includes('approval:submit')){
    throw new AccessError('CLINICIAN_APPROVAL_REQUIRED','Medication reconciliation submission requires approval:submit.',403);
  }

  if(session.evidence.snapshotHash!==session.aiReview.evidenceSnapshotHash){
    fail('MEDICATION_RECONCILIATION_EVIDENCE_CHANGED','The evidence snapshot changed after AI review. Restart reconciliation.',409);
  }

  const decisionMap=new Map(
    (Array.isArray(decisions)?decisions:[])
      .map(x=>[String(x?.medicationKey||''),x])
  );

  const reviewed=session.evidence.lines.map(line=>{
    const decision=decisionMap.get(line.medicationKey);
    if(!decision){
      fail(
        'MEDICATION_RECONCILIATION_DECISION_REQUIRED',
        `A human reconciliation decision is required for ${line.medicationDisplay}.`,
        400
      );
    }
    return decisionForLine(line,decision);
  });

  const deferred=reviewed.filter(x=>x.state==='DEFERRED');

  session.status=deferred.length
    ?'PARTIALLY_RECONCILED_HUMAN_REVIEWED'
    :'RECONCILED_HUMAN_REVIEWED';

  session.humanReview={
    required:true,
    status:deferred.length?'PARTIALLY_RECONCILED':'RECONCILED',
    reviewerActorId:context.actor.id,
    reviewerDisplay:context.actor.display,
    reviewedAt:iso(),
    comment:String(comment||'').trim().slice(0,500)||null,
    decisions:reviewed,
    evidenceSnapshotHash:session.evidence.snapshotHash
  };

  session.outcome={
    reconciledMedicationListAuthoritative:true,
    authoritativeBy:'HUMAN_REVIEW',
    resolvedCount:reviewed.filter(x=>x.state==='RESOLVED').length,
    deferredCount:deferred.length,
    ehrWritebackSupported:false,
    ehrWritten:false,
    prescriptionChanged:false,
    orderCreated:false,
    destination:null,
    reason:'Human medication-reconciliation decisions are recorded in the demo only. No EHR medication list, prescription, or order is changed.'
  };

  audit(
    deferred.length?'HUMAN_MED_REC_PARTIALLY_RECONCILED':'HUMAN_MED_REC_RECONCILED',
    {
      session,
      actor:context.actor,
      details:{
        evidenceSnapshotHash:session.evidence.snapshotHash,
        resolvedMedicationKeys:reviewed.filter(x=>x.state==='RESOLVED').map(x=>x.medicationKey),
        deferredMedicationKeys:deferred.map(x=>x.medicationKey),
        comment:session.humanReview.comment
      }
    }
  );

  audit('MED_REC_NON_EXECUTION_CONFIRMED',{
    session,
    actor:context.actor,
    details:{
      ehrWritebackSupported:false,
      ehrWritten:false,
      prescriptionChanged:false,
      orderCreated:false
    }
  });

  return publicSession(session);
}

export function medicationReconciliationAudit({
  actorId=null,
  patientId=null,
  sessionId=null,
  limit=50
}={}){
  const patient=patientId?patients[patientId]:null;

  return auditEvents
    .filter(e=>
      (!actorId||e.actorId===actorId) &&
      (!sessionId||e.sessionId===sessionId) &&
      (!patient||e.patientPseudonym===patient.pseudonym)
    )
    .slice(0,Math.max(1,Math.min(Number(limit)||50,100)))
    .map(clone);
}

export function medicationReconciliationSummary({
  actorId=DEFAULT_ACTOR_ID,
  patientId=DEFAULT_PATIENT_ID
}={}){
  const actor=workforce[actorId];
  const patient=patients[patientId];
  if(!actor||!patient)return null;

  const session=latestSession(actorId,patientId);

  return {
    actor:{
      id:actor.id,
      display:actor.display,
      role:actor.role,
      specialty:actor.specialty
    },
    patient:{
      display:patient.name,
      pseudonym:patient.pseudonym
    },
    session:publicSession(session),
    evidence:medicationReconciliationEvidence(patientId),
    audit:medicationReconciliationAudit({
      patientId,
      sessionId:session?.sessionId||null,
      limit:20
    }),
    policy:{
      aiMayCompareSources:true,
      aiMayDraftReconciliationReview:true,
      aiMaySelectAuthoritativeWinner:false,
      recencyAloneMaySelectWinner:false,
      humanResolutionRequired:true,
      perMedicationDecisionRequired:true,
      deferForClarificationSupported:true,
      ehrWritebackSupported:false,
      prescriptionExecutionSupported:false,
      realOrderCreated:false
    }
  };
}

export function resetMedicationReconciliation({
  actorId=DEFAULT_ACTOR_ID,
  patientId=DEFAULT_PATIENT_ID
}={}){
  for(const [sessionId,session] of sessions.entries()){
    if(session.actorId===actorId&&session.patientId===patientId)sessions.delete(sessionId);
  }

  const patient=patients[patientId];
  for(let i=auditEvents.length-1;i>=0;i--){
    if(auditEvents[i].patientPseudonym===patient?.pseudonym)auditEvents.splice(i,1);
  }

  return medicationReconciliationSummary({actorId,patientId});
}

export function createMedicationReconciliationForTest({
  actorId=DEFAULT_ACTOR_ID,
  patientId=DEFAULT_PATIENT_ID
}={}){
  const context=resolveClinicianContext({
    actorId,
    patientId,
    encounterId:null,
    purpose:'medication-review'
  });

  const evidence=sourceSnapshot();
  const session=buildBaseSession({
    actorId,
    patientId,
    aiReview:{
      contribution:'DISCREPANCY_SYNTHESIS',
      model:'test-model',
      proxy:'clinical-ai-secure',
      mode:'test',
      draft:'Synthetic AI draft: medication sources disagree; human reconciliation is required.',
      authority:false,
      maySelectWinner:false,
      evidenceSnapshotHash:evidence.snapshotHash
    }
  });

  sessions.set(session.sessionId,session);

  audit('MED_REC_SOURCE_SNAPSHOT_ASSEMBLED',{
    session,
    actor:context.actor,
    details:{testFixture:true}
  });
  audit('AI_RECONCILIATION_DRAFT_CREATED',{
    session,
    actor:context.actor,
    details:{testFixture:true,authority:false}
  });
  audit('HUMAN_RECONCILIATION_REQUIRED',{
    session,
    actor:context.actor,
    details:{testFixture:true}
  });

  return publicSession(session);
}
