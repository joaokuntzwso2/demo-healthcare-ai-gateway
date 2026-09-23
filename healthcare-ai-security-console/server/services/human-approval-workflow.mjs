import crypto from 'node:crypto';
import { workforce, patients } from '../data/synthetic-healthcare.mjs';
import { resolveClinicianContext, AccessError } from './context.mjs';
import { invokeModel, gatewayConfig } from './gateway-client.mjs';
import { labFreshnessSummary } from './lab-result-lineage.mjs';

const DEFAULT_ACTOR='neph-001';
const DEFAULT_PATIENT='pat-1001';

const proposals=new Map();
const auditEvents=[];

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function id(prefix){return `${prefix}-${crypto.randomUUID()}`;}
function iso(){return new Date().toISOString();}

function fail(code,message,status=400){
  throw Object.assign(new Error(message),{code,status});
}

function actorOrFail(actorId){
  const actor=workforce[actorId];
  if(!actor)fail('CLINICAL_DATA_NOT_AUTHORIZED','Unknown workforce identity.',403);
  return actor;
}

function patientOrFail(patientId){
  const patient=patients[patientId];
  if(!patient)fail('PATIENT_SCOPE_MISMATCH','Unknown patient context.',404);
  return patient;
}

function workflowKey(actorId,patientId){
  return `${actorId}|${patientId}`;
}

function latestProposal(actorId,patientId){
  return [...proposals.values()]
    .filter(x=>x.actorId===actorId&&x.patientId===patientId)
    .sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0]||null;
}

function safeModelDraft(value=''){
  return String(value||'')
    .replace(/\b(?:pat|portal|hosp|cardio|clin|nurse|care|neph|endo|pharm|er)-\d+\b/gi,'[internal-id-redacted]')
    .replace(/\bHN-P-[A-Z0-9-]+\b/gi,'[patient-pseudonym-redacted]')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,900);
}

function currentEvidence(patientId){
  const freshness=labFreshnessSummary(patientId);
  if(!freshness?.currentResult)fail('TRUSTED_CLINICAL_SOURCE_REQUIRED','Current authoritative potassium evidence is unavailable.',409);

  const chain=freshness.labResultLineage?.resultChains?.[0];
  const original=chain?.versions?.find(v=>v.version===1);
  const current=chain?.versions?.find(v=>v.current===true);

  if(!chain||!original||!current)fail('TRUSTED_CLINICAL_SOURCE_REQUIRED','Versioned potassium lineage is unavailable.',409);

  return {
    evidenceType:'AUTHORITATIVE PATIENT FACT',
    source:'LAB-SYSTEM',
    resultChainId:chain.chainId,
    analyte:chain.display,
    current:{
      resultVersionId:current.resultVersionId,
      version:current.version,
      value:current.value,
      unit:current.unit,
      status:current.status,
      observedAt:current.observedAt,
      issuedAt:current.issuedAt,
      corrected:true
    },
    superseded:[{
      resultVersionId:original.resultVersionId,
      version:original.version,
      value:original.value,
      unit:original.unit,
      status:original.status,
      observedAt:original.observedAt,
      issuedAt:original.issuedAt
    }],
    selectionRule:chain.selectionRule?.rule||'LATEST_VALID_VERSION_IN_RESULT_CHAIN',
    provenance:{
      sourceSystem:chain.provenance?.sourceSystem||'LAB-SYSTEM',
      sourceRecordId:chain.provenance?.sourceRecordId||null,
      correctionIssuedAt:chain.provenance?.correctionIssuedAt||null
    }
  };
}

function audit(type,{proposal,actor,details=null}={}){
  const patient=proposal?patients[proposal.patientId]:null;
  const event={
    eventId:id('approval-audit'),
    type,
    severity:type==='HUMAN_REVIEW_REJECTED'?'HIGH':'MEDIUM',
    at:iso(),
    proposalId:proposal?.proposalId||null,
    actorId:actor?.id||null,
    actorDisplay:actor?.display||null,
    patientPseudonym:patient?.pseudonym||null,
    workflow:'FULL_HUMAN_APPROVAL',
    authority:
      type==='AI_PROPOSAL_CREATED'?'AI_ASSISTED':
      (type==='HUMAN_REVIEW_APPROVED'||type==='HUMAN_REVIEW_REJECTED')?'HUMAN':
      'SYSTEM',
    executed:false,
    details
  };
  auditEvents.unshift(event);
  if(auditEvents.length>250)auditEvents.length=250;
  return event;
}

function publicProposal(proposal){
  if(!proposal)return null;
  const actor=workforce[proposal.actorId];
  const patient=patients[proposal.patientId];
  return {
    proposalId:proposal.proposalId,
    workflowType:'FULL_HUMAN_APPROVAL',
    status:proposal.status,
    createdAt:proposal.createdAt,
    actor:{
      id:actor?.id||proposal.actorId,
      display:actor?.display||proposal.actorId,
      role:actor?.role||null,
      specialty:actor?.specialty||null
    },
    patient:{
      display:patient?.name||'Synthetic patient',
      pseudonym:patient?.pseudonym||null
    },
    proposedAction:clone(proposal.proposedAction),
    ai:clone(proposal.ai),
    evidence:clone(proposal.evidence),
    humanReview:clone(proposal.humanReview),
    execution:clone(proposal.execution)
  };
}

export async function createHumanApprovalProposal({
  actorId=DEFAULT_ACTOR,
  patientId=DEFAULT_PATIENT
}={}){
  const context=resolveClinicianContext({
    actorId,
    patientId,
    encounterId:null,
    purpose:'lab-review'
  });

  if(!context.scopes.includes('labs:read')){
    throw new AccessError('CLINICAL_DATA_NOT_AUTHORIZED','Lab-review scope is required.',403);
  }

  const existing=latestProposal(actorId,patientId);
  if(existing?.status==='PENDING_HUMAN_REVIEW'){
    return publicProposal(existing);
  }

  const evidence=currentEvidence(patientId);

  const system=[
    'You are a bounded clinical workflow drafting assistant in a fully synthetic demonstration.',
    'You do not have clinical authority and you cannot create, submit, approve, reject, or execute an order.',
    'Draft a short non-authoritative proposal for physician review only.',
    'The requested synthetic workflow proposal is: repeat potassium tomorrow.',
    'Base any evidence statement only on the supplied versioned laboratory evidence.',
    'Do not claim that an order exists or that the proposal has been approved.'
  ].join(' ');

  const user=[
    'Draft the physician-review proposal.',
    `Current authoritative potassium: ${evidence.current.value} ${evidence.current.unit}, version ${evidence.current.version}, status ${evidence.current.status}.`,
    `Superseded potassium: ${evidence.superseded[0].value} ${evidence.superseded[0].unit}, status ${evidence.superseded[0].status}.`,
    `Correction issued: ${evidence.provenance.correctionIssuedAt}.`,
    'Requested proposal wording: repeat potassium tomorrow.',
    'This is a synthetic workflow demonstration, not medical advice.'
  ].join(' ');

  const model=await invokeModel({
    context,
    messages:[
      {role:'system',content:system},
      {role:'user',content:user}
    ],
    maxTokens:220,
    temperature:0
  });

  if(model.status>=400){
    fail(
      'AI_PROPOSAL_GATEWAY_FAILED',
      `WSO2 AI Gateway did not return an AI proposal draft (HTTP ${model.status}).`,
      502
    );
  }

  const draft=model.mode==='deterministic'
    ? 'Synthetic AI workflow proposal: repeat potassium tomorrow. Physician review and explicit approval or rejection are required; no order has been created.'
    : safeModelDraft(model.message?.content??model.content??'');

  const proposal={
    proposalId:id('clinical-proposal'),
    actorId,
    patientId,
    createdAt:iso(),
    status:'PENDING_HUMAN_REVIEW',
    proposedAction:{
      type:'REPEAT_LAB_TEST',
      test:'Potassium',
      timing:'tomorrow',
      statement:'Repeat potassium tomorrow.',
      authoritative:false,
      createdBy:'AI_ASSISTANT',
      requiresHumanDecision:true
    },
    ai:{
      contribution:'DRAFT_PROPOSAL',
      model:model.model,
      proxy:model.proxy||gatewayConfig().clinicianProxy,
      mode:model.mode,
      draft,
      authority:false
    },
    evidence,
    humanReview:{
      required:true,
      status:'PENDING',
      reviewerActorId:null,
      reviewerDisplay:null,
      decision:null,
      comment:null,
      reviewedAt:null,
      evidenceReviewed:false
    },
    execution:{
      supported:false,
      executed:false,
      orderId:null,
      destination:null,
      reason:'This demo records the human decision only. It does not create or transmit a real laboratory order.'
    }
  };

  proposals.set(proposal.proposalId,proposal);

  audit('AI_PROPOSAL_CREATED',{
    proposal,
    actor:context.actor,
    details:{
      proposedAction:proposal.proposedAction.statement,
      model:proposal.ai.model,
      proxy:proposal.ai.proxy,
      currentEvidence:`${proposal.evidence.current.value} ${proposal.evidence.current.unit}`,
      executed:false
    }
  });

  audit('HUMAN_REVIEW_REQUIRED',{
    proposal,
    actor:context.actor,
    details:{
      approvalRequired:true,
      rejectionSupported:true,
      executionSupported:false
    }
  });

  return publicProposal(proposal);
}

export function reviewHumanApprovalProposal({
  proposalId,
  reviewerActorId=DEFAULT_ACTOR,
  decision,
  comment=''
}={}){
  const proposal=proposals.get(proposalId);
  if(!proposal)fail('CLINICIAN_APPROVAL_REQUIRED','Unknown human-approval proposal.',404);

  if(proposal.status!=='PENDING_HUMAN_REVIEW'){
    fail('HUMAN_REVIEW_ALREADY_COMPLETED','This proposal already has a final human decision.',409);
  }

  const reviewerContext=resolveClinicianContext({
    actorId:reviewerActorId,
    patientId:proposal.patientId,
    encounterId:null,
    purpose:'lab-review'
  });

  if(!reviewerContext.scopes.includes('approval:submit')){
    throw new AccessError('CLINICIAN_APPROVAL_REQUIRED','The reviewer does not have the approval:submit scope.',403);
  }

  const normalized=String(decision||'').trim().toUpperCase();
  if(!['APPROVE','REJECT'].includes(normalized)){
    fail('INVALID_HUMAN_REVIEW_DECISION','Decision must be APPROVE or REJECT.',400);
  }

  const reviewedAt=iso();
  proposal.humanReview={
    required:true,
    status:normalized==='APPROVE'?'APPROVED':'REJECTED',
    reviewerActorId:reviewerContext.actor.id,
    reviewerDisplay:reviewerContext.actor.display,
    decision:normalized,
    comment:String(comment||'').trim().slice(0,500)||null,
    reviewedAt,
    evidenceReviewed:true
  };

  proposal.status=normalized==='APPROVE'
    ? 'APPROVED_NOT_EXECUTED'
    : 'REJECTED';

  proposal.execution={
    supported:false,
    executed:false,
    orderId:null,
    destination:null,
    reason:normalized==='APPROVE'
      ? 'Human approval was recorded, but this demonstration intentionally does not execute or transmit a laboratory order.'
      : 'Human rejection was recorded. No laboratory order was created or transmitted.'
  };

  audit(normalized==='APPROVE'?'HUMAN_REVIEW_APPROVED':'HUMAN_REVIEW_REJECTED',{
    proposal,
    actor:reviewerContext.actor,
    details:{
      decision:normalized,
      evidenceReviewed:true,
      comment:proposal.humanReview.comment,
      executed:false,
      orderId:null
    }
  });

  audit('NON_EXECUTION_CONFIRMED',{
    proposal,
    actor:reviewerContext.actor,
    details:{
      approved:normalized==='APPROVE',
      executionSupported:false,
      executed:false,
      destination:null,
      orderId:null
    }
  });

  return publicProposal(proposal);
}

export function humanApprovalAudit({
  actorId=null,
  patientId=null,
  proposalId=null,
  limit=50
}={}){
  const patient=patientId?patients[patientId]:null;
  return auditEvents
    .filter(e=>
      (!actorId||e.actorId===actorId) &&
      (!proposalId||e.proposalId===proposalId) &&
      (!patient||e.patientPseudonym===patient.pseudonym)
    )
    .slice(0,Math.max(1,Math.min(Number(limit)||50,100)))
    .map(clone);
}

export function humanApprovalSummary({
  actorId=DEFAULT_ACTOR,
  patientId=DEFAULT_PATIENT
}={}){
  const actor=actorOrFail(actorId);
  const patient=patientOrFail(patientId);
  const proposal=latestProposal(actorId,patientId);

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
    proposal:publicProposal(proposal),
    audit:humanApprovalAudit({patientId,proposalId:proposal?.proposalId||null,limit:20}),
    policy:{
      aiMayPropose:true,
      aiMayApprove:false,
      aiMayReject:false,
      humanDecisionRequired:true,
      evidenceReviewRequired:true,
      executionSupported:false,
      realOrderCreated:false,
      terminalStates:['APPROVED_NOT_EXECUTED','REJECTED']
    }
  };
}

export function resetHumanApprovalWorkflow({
  actorId=DEFAULT_ACTOR,
  patientId=DEFAULT_PATIENT
}={}){
  for(const [proposalId,proposal] of proposals.entries()){
    if(proposal.actorId===actorId&&proposal.patientId===patientId){
      proposals.delete(proposalId);
    }
  }

  const patient=patients[patientId];
  for(let i=auditEvents.length-1;i>=0;i--){
    if(auditEvents[i].patientPseudonym===patient?.pseudonym){
      auditEvents.splice(i,1);
    }
  }

  return humanApprovalSummary({actorId,patientId});
}

export function createProposalForTest({
  actorId=DEFAULT_ACTOR,
  patientId=DEFAULT_PATIENT,
  modelDraft='Synthetic AI workflow proposal: repeat potassium tomorrow.'
}={}){
  const context=resolveClinicianContext({
    actorId,
    patientId,
    encounterId:null,
    purpose:'lab-review'
  });
  const evidence=currentEvidence(patientId);

  const proposal={
    proposalId:id('clinical-proposal'),
    actorId,
    patientId,
    createdAt:iso(),
    status:'PENDING_HUMAN_REVIEW',
    proposedAction:{
      type:'REPEAT_LAB_TEST',
      test:'Potassium',
      timing:'tomorrow',
      statement:'Repeat potassium tomorrow.',
      authoritative:false,
      createdBy:'AI_ASSISTANT',
      requiresHumanDecision:true
    },
    ai:{
      contribution:'DRAFT_PROPOSAL',
      model:'test-model',
      proxy:'clinical-ai-secure',
      mode:'test',
      draft:safeModelDraft(modelDraft),
      authority:false
    },
    evidence,
    humanReview:{
      required:true,
      status:'PENDING',
      reviewerActorId:null,
      reviewerDisplay:null,
      decision:null,
      comment:null,
      reviewedAt:null,
      evidenceReviewed:false
    },
    execution:{
      supported:false,
      executed:false,
      orderId:null,
      destination:null,
      reason:'This demo records the human decision only. It does not create or transmit a real laboratory order.'
    }
  };

  proposals.set(proposal.proposalId,proposal);
  audit('AI_PROPOSAL_CREATED',{proposal,actor:context.actor,details:{testFixture:true,executed:false}});
  audit('HUMAN_REVIEW_REQUIRED',{proposal,actor:context.actor,details:{testFixture:true,executionSupported:false}});
  return publicProposal(proposal);
}
