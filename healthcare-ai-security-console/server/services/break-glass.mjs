import crypto from 'node:crypto';
import { patients, workforce } from '../data/synthetic-healthcare.mjs';
import { careRelationshipDecision } from './care-team-handoff.mjs';

const DEFAULT_TTL_SECONDS=600;
const MAX_TTL_SECONDS=900;
const STEP_UP_REQUEST_TTL_SECONDS=300;

const pendingRequests=new Map();
const activeGrants=new Map();
const auditEvents=[];

function nowMs(){return Date.now();}
function iso(ms=nowMs()){return new Date(ms).toISOString();}
function key(actorId,patientId){return `${actorId}|${patientId}`;}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function id(prefix){return `${prefix}-${crypto.randomUUID()}`;}

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

function assertSameTenant(actor,patient){
  if(actor.tenant!==patient.tenant)fail('TENANT_BOUNDARY_VIOLATION','Break-glass cannot cross tenant boundaries.',403);
}

function assertEmergencyEligible(actor){
  if(actor.role!=='emergency-physician'){
    fail('BREAK_GLASS_NOT_ELIGIBLE','Only the synthetic emergency-physician role may activate this break-glass demonstration.',403);
  }
}

function safePatientRef(patient){
  return patient.pseudonym||'SYNTHETIC-PATIENT';
}

function audit(type,{actor,patient,reason=null,requestId=null,grantId=null,stepUpMethod=null,purpose=null,expiresAt=null,details=null}={}){
  const event={
    eventId:id('audit'),
    type,
    severity:'HIGH',
    reasonCode:'BREAK_GLASS_EMERGENCY_ACCESS',
    at:iso(),
    actorId:actor?.id||null,
    actorDisplay:actor?.display||null,
    patientPseudonym:patient?safePatientRef(patient):null,
    reason,
    requestId,
    grantId,
    stepUpMethod,
    purpose,
    expiresAt,
    details
  };
  auditEvents.unshift(event);
  if(auditEvents.length>250)auditEvents.length=250;
  return event;
}

function expireGrantIfNeeded(grant){
  if(!grant)return null;
  if(grant.status!=='ACTIVE')return null;
  if(nowMs()<Date.parse(grant.expiresAt))return grant;
  grant.status='EXPIRED';
  activeGrants.delete(key(grant.actorId,grant.patientId));
  const actor=workforce[grant.actorId];
  const patient=patients[grant.patientId];
  audit('BREAK_GLASS_EXPIRED',{
    actor,
    patient,
    reason:grant.reason,
    grantId:grant.grantId,
    stepUpMethod:grant.stepUpMethod,
    expiresAt:grant.expiresAt
  });
  return null;
}

function publicRequest(request){
  if(!request)return null;
  return {
    requestId:request.requestId,
    status:request.status,
    actorId:request.actorId,
    actorDisplay:workforce[request.actorId]?.display||request.actorId,
    patientPseudonym:patients[request.patientId]?.pseudonym||null,
    reason:request.reason,
    requestedAt:request.requestedAt,
    challengeExpiresAt:request.challengeExpiresAt,
    requiredStepUp:'webauthn',
    severity:'HIGH'
  };
}

function publicGrant(grant){
  if(!grant)return null;
  return {
    grantId:grant.grantId,
    status:grant.status,
    active:grant.status==='ACTIVE',
    mode:'break-glass',
    actorId:grant.actorId,
    actorDisplay:workforce[grant.actorId]?.display||grant.actorId,
    patientPseudonym:patients[grant.patientId]?.pseudonym||null,
    reason:grant.reason,
    stepUpMethod:grant.stepUpMethod,
    grantedAt:grant.grantedAt,
    expiresAt:grant.expiresAt,
    severity:'HIGH',
    useCount:grant.useCount||0
  };
}

export function requestBreakGlassAccess({
  actorId='er-001',
  patientId='pat-1001',
  reason=''
}={}){
  const actor=actorOrFail(actorId);
  const patient=patientOrFail(patientId);
  assertSameTenant(actor,patient);
  assertEmergencyEligible(actor);

  const normal=careRelationshipDecision({actorId,patientId});
  if(normal.allowed){
    fail('BREAK_GLASS_NOT_REQUIRED','The clinician already has an active normal care relationship; break-glass is not required.',409);
  }

  const normalized=String(reason||'').trim().replace(/\s+/g,' ');
  if(normalized.length<12){
    fail('BREAK_GLASS_REASON_REQUIRED','A meaningful emergency-access reason of at least 12 characters is required.',400);
  }

  const previous=activeBreakGlassGrant({actorId,patientId});
  if(previous){
    fail('BREAK_GLASS_ALREADY_ACTIVE','An active break-glass grant already exists for this clinician and patient.',409);
  }

  const requestId=id('bgreq');
  const requestedAt=nowMs();
  const request={
    requestId,
    actorId,
    patientId,
    reason:normalized,
    requestedAt:iso(requestedAt),
    challengeExpiresAt:iso(requestedAt+STEP_UP_REQUEST_TTL_SECONDS*1000),
    status:'STEP_UP_REQUIRED'
  };
  pendingRequests.set(requestId,request);

  audit('BREAK_GLASS_REQUESTED',{
    actor,
    patient,
    reason:normalized,
    requestId,
    details:{normalRelationshipActive:false,stepUpRequired:true}
  });

  return publicRequest(request);
}

export function completeBreakGlassStepUp({
  requestId,
  stepUp={method:'webauthn',verified:false},
  durationSeconds=DEFAULT_TTL_SECONDS
}={}){
  const request=pendingRequests.get(requestId);
  if(!request)fail('BREAK_GLASS_REQUEST_NOT_FOUND','Unknown or completed break-glass request.',404);

  const actor=actorOrFail(request.actorId);
  const patient=patientOrFail(request.patientId);
  assertSameTenant(actor,patient);
  assertEmergencyEligible(actor);

  if(request.status!=='STEP_UP_REQUIRED'){
    fail('BREAK_GLASS_REQUEST_INVALID','Break-glass request is not awaiting step-up.',409);
  }
  if(nowMs()>=Date.parse(request.challengeExpiresAt)){
    request.status='EXPIRED';
    pendingRequests.delete(requestId);
    audit('BREAK_GLASS_REQUEST_EXPIRED',{actor,patient,reason:request.reason,requestId});
    fail('BREAK_GLASS_STEP_UP_EXPIRED','The break-glass step-up challenge expired. Start a new request.',410);
  }

  const method=String(stepUp?.method||'').toLowerCase();
  const verified=stepUp?.verified===true;
  if(!verified||!['webauthn','totp'].includes(method)){
    audit('BREAK_GLASS_STEP_UP_FAILED',{
      actor,
      patient,
      reason:request.reason,
      requestId,
      stepUpMethod:method||null,
      details:{verified:false}
    });
    fail('BREAK_GLASS_STEP_UP_REQUIRED','Verified WebAuthn or TOTP step-up authentication is required.',403);
  }

  const ttl=Math.max(60,Math.min(Number(durationSeconds)||DEFAULT_TTL_SECONDS,MAX_TTL_SECONDS));
  const grantedAt=nowMs();
  const grant={
    grantId:id('bggrant'),
    actorId:request.actorId,
    patientId:request.patientId,
    reason:request.reason,
    stepUpMethod:method,
    stepUpVerified:true,
    grantedAt:iso(grantedAt),
    expiresAt:iso(grantedAt+ttl*1000),
    status:'ACTIVE',
    useCount:0
  };

  request.status='COMPLETED';
  pendingRequests.delete(requestId);
  activeGrants.set(key(grant.actorId,grant.patientId),grant);

  audit('BREAK_GLASS_STEP_UP_VERIFIED',{
    actor,
    patient,
    reason:grant.reason,
    requestId,
    grantId:grant.grantId,
    stepUpMethod:method,
    expiresAt:grant.expiresAt
  });
  audit('BREAK_GLASS_GRANTED',{
    actor,
    patient,
    reason:grant.reason,
    requestId,
    grantId:grant.grantId,
    stepUpMethod:method,
    expiresAt:grant.expiresAt,
    details:{temporary:true,ttlSeconds:ttl,normalRelationshipActive:false}
  });

  return publicGrant(grant);
}

export function activeBreakGlassGrant({actorId,patientId}={}){
  const grant=activeGrants.get(key(actorId,patientId));
  return clone(expireGrantIfNeeded(grant));
}

export function recordBreakGlassUse({grantId,actorId,patientId,purpose='encounter-summary'}={}){
  const grant=expireGrantIfNeeded(activeGrants.get(key(actorId,patientId)));
  if(!grant||grant.grantId!==grantId){
    fail('BREAK_GLASS_REQUIRED','A valid active emergency-access grant is required.',403);
  }
  grant.useCount=(grant.useCount||0)+1;
  const actor=workforce[actorId];
  const patient=patients[patientId];
  audit('BREAK_GLASS_USED',{
    actor,
    patient,
    reason:grant.reason,
    grantId:grant.grantId,
    stepUpMethod:grant.stepUpMethod,
    purpose,
    expiresAt:grant.expiresAt,
    details:{useCount:grant.useCount,access:'AI_PATIENT_CONTEXT'}
  });
  return publicGrant(grant);
}

export function revokeBreakGlassAccess({actorId='er-001',patientId='pat-1001'}={}){
  const grant=expireGrantIfNeeded(activeGrants.get(key(actorId,patientId)));
  if(!grant)return breakGlassSummary({actorId,patientId});
  activeGrants.delete(key(actorId,patientId));
  grant.status='REVOKED';
  const actor=workforce[actorId];
  const patient=patients[patientId];
  audit('BREAK_GLASS_REVOKED',{
    actor,
    patient,
    reason:grant.reason,
    grantId:grant.grantId,
    stepUpMethod:grant.stepUpMethod,
    expiresAt:grant.expiresAt
  });
  return breakGlassSummary({actorId,patientId});
}

export function breakGlassAudit({actorId=null,patientId=null,limit=50}={}){
  const patient=patientId?patients[patientId]:null;
  const pseudonym=patient?safePatientRef(patient):null;
  return auditEvents
    .filter(e=>(!actorId||e.actorId===actorId)&&(!pseudonym||e.patientPseudonym===pseudonym))
    .slice(0,Math.max(1,Math.min(Number(limit)||50,100)))
    .map(clone);
}

export function breakGlassSummary({actorId='er-001',patientId='pat-1001'}={}){
  const actor=actorOrFail(actorId);
  const patient=patientOrFail(patientId);
  assertSameTenant(actor,patient);
  const grant=activeBreakGlassGrant({actorId,patientId});
  const pending=[...pendingRequests.values()]
    .filter(r=>r.actorId===actorId&&r.patientId===patientId)
    .sort((a,b)=>Date.parse(b.requestedAt)-Date.parse(a.requestedAt))[0]||null;
  const normal=careRelationshipDecision({actorId,patientId});

  return {
    actor:{id:actor.id,display:actor.display,role:actor.role,specialty:actor.specialty},
    patient:{display:patient.name,pseudonym:patient.pseudonym},
    normalRelationshipActive:normal.allowed,
    accessMode:grant?'BREAK_GLASS_ACTIVE':'NORMAL_RELATIONSHIP_REQUIRED',
    pendingRequest:publicRequest(pending),
    activeGrant:publicGrant(grant),
    audit:breakGlassAudit({actorId,patientId,limit:20}),
    policy:{
      explicitReasonRequired:true,
      stepUpRequired:true,
      acceptedStepUpMethods:['webauthn','totp'],
      defaultTtlSeconds:DEFAULT_TTL_SECONDS,
      maxTtlSeconds:MAX_TTL_SECONDS,
      auditSeverity:'HIGH'
    }
  };
}

export function resetBreakGlassDemo({actorId='er-001',patientId='pat-1001'}={}){
  for(const [requestId,request] of pendingRequests.entries()){
    if(request.actorId===actorId&&request.patientId===patientId)pendingRequests.delete(requestId);
  }
  activeGrants.delete(key(actorId,patientId));
  for(let i=auditEvents.length-1;i>=0;i--){
    const e=auditEvents[i];
    const patient=patients[patientId];
    if(e.actorId===actorId&&e.patientPseudonym===patient?.pseudonym)auditEvents.splice(i,1);
  }
  return breakGlassSummary({actorId,patientId});
}

export function forceExpireBreakGlassForTest({actorId='er-001',patientId='pat-1001'}={}){
  const grant=activeGrants.get(key(actorId,patientId));
  if(!grant)return null;
  grant.expiresAt=iso(nowMs()-1000);
  return activeBreakGlassGrant({actorId,patientId});
}
