import crypto from 'node:crypto';
import { patients, workforce, isClinicianAssignedToPatient } from '../data/synthetic-healthcare.mjs';

export const RESTRICTED_CATEGORY='behavioral-health';
export const RESTRICTED_PURPOSE='behavioral-health-treatment';
export const RESTRICTED_SCOPE='restricted:behavioral-health:read';
export const RESTRICTED_TOOL='get_restricted_clinical_information';
export const RESTRICTED_SOURCE='EHR-RESTRICTED-BEHAVIORAL-HEALTH';

const DEMO_PATIENT_ID='pat-1004';
const AUTHORIZED_ACTOR_ID='bh-001';
const ORDINARY_ACTOR_ID='endo-001';

const restrictedRecords={
  [DEMO_PATIENT_ID]:{
    id:'restricted-bh-followup-1004',
    patientId:DEMO_PATIENT_ID,
    tenant:'helios-north',
    category:RESTRICTED_CATEGORY,
    sensitivity:'RESTRICTED',
    source:RESTRICTED_SOURCE,
    recordedAt:'2026-09-08T14:00:00Z',
    record:{
      type:'behavioral-health-follow-up',
      summary:'Synthetic behavioral-health follow-up record for demonstration purposes.',
      plan:'Continue clinician-directed behavioral-health follow-up. This fixture is not medical advice.'
    }
  }
};

const baselineAuthorization={
  authorizationId:'restricted-auth-bh-1004',
  patientId:DEMO_PATIENT_ID,
  tenant:'helios-north',
  category:RESTRICTED_CATEGORY,
  permittedActorIds:[AUTHORIZED_ACTOR_ID],
  permittedPurposes:[RESTRICTED_PURPOSE],
  effectiveAt:'2026-09-01T00:00:00Z',
  expiresAt:'2099-12-31T23:59:59Z',
  basis:'SYNTHETIC_PATIENT_AUTHORIZATION'
};

let authorizationActive=true;
const auditEvents=[];

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function now(){return new Date().toISOString();}
function id(prefix){return `${prefix}-${crypto.randomUUID()}`;}

function accessError(message,details={}){
  return Object.assign(new Error(message),{
    code:'RESTRICTED_RECORD_ACCESS_DENIED',
    status:403,
    details
  });
}

function authorizationCurrentlyValid(){
  if(!authorizationActive)return false;
  const t=Date.now();
  return t>=Date.parse(baselineAuthorization.effectiveAt) &&
    t<Date.parse(baselineAuthorization.expiresAt);
}

export function restrictedClinicalRequestMatches(query=''){
  return /\b(?:behavioral[\s-]+health|mental[\s-]+health|psychiatr\w*|psychotherap\w*|restricted\s+(?:clinical\s+)?record|restricted\s+clinical\s+information)\b/i.test(String(query||''));
}

export function restrictedAuthorizationProjection({
  actorId,
  patientId,
  purpose,
  scopes
}={}){
  const actor=workforce[actorId];
  const patient=patients[patientId];
  const effectiveScopes=Array.isArray(scopes)?scopes:(actor?.scopes||[]);
  const sameTenant=Boolean(actor&&patient&&actor.tenant===patient.tenant);
  const careRelationship=Boolean(actor&&patient&&isClinicianAssignedToPatient(actorId,patientId));
  const scopePresent=effectiveScopes.includes(RESTRICTED_SCOPE);
  const authorizationMatchesPatient=
    baselineAuthorization.patientId===patientId &&
    baselineAuthorization.tenant===patient?.tenant;
  const authorizationMatchesActor=
    baselineAuthorization.permittedActorIds.includes(actorId);
  const purposeAuthorized=
    baselineAuthorization.permittedPurposes.includes(String(purpose||''));
  const patientAuthorizationPresent=
    authorizationCurrentlyValid() &&
    authorizationMatchesPatient &&
    authorizationMatchesActor;

  return {
    type:'RESTRICTED_RECORD_AUTHORIZATION',
    category:RESTRICTED_CATEGORY,
    requiredScope:RESTRICTED_SCOPE,
    purpose:String(purpose||''),
    requiredPurpose:RESTRICTED_PURPOSE,
    sameTenant,
    careRelationship,
    ordinaryChartAccess:Boolean(effectiveScopes.includes('chart:summary')),
    scopePresent,
    patientAuthorizationPresent,
    purposeAuthorized,
    active:Boolean(
      sameTenant &&
      careRelationship &&
      scopePresent &&
      patientAuthorizationPresent &&
      purposeAuthorized
    ),
    authorizationId:patientAuthorizationPresent?baselineAuthorization.authorizationId:null,
    authorizationBasis:patientAuthorizationPresent?baselineAuthorization.basis:null,
    expiresAt:patientAuthorizationPresent?baselineAuthorization.expiresAt:null,
    segmentReleased:false
  };
}

function recordAudit({
  actorId,
  patientId,
  purpose,
  operation,
  decision,
  reasonCode=null,
  authorization=null,
  details=null
}={}){
  const actor=workforce[actorId];
  const patient=patients[patientId];
  const event={
    eventId:id('restricted-audit'),
    type:'RESTRICTED_CLINICAL_INFORMATION_AUTHORIZATION',
    authority:'SYSTEM',
    at:now(),
    actorId:actor?.id||actorId||null,
    actorDisplay:actor?.display||null,
    actorRole:actor?.role||null,
    patientPseudonym:patient?.pseudonym||null,
    category:RESTRICTED_CATEGORY,
    purpose:purpose||null,
    operation:operation||null,
    decision:decision||null,
    reasonCode,
    authorization:{
      scopePresent:Boolean(authorization?.scopePresent),
      patientAuthorizationPresent:Boolean(authorization?.patientAuthorizationPresent),
      purposeAuthorized:Boolean(authorization?.purposeAuthorized),
      careRelationship:Boolean(authorization?.careRelationship),
      authorizationId:authorization?.authorizationId||null
    },
    details
  };
  auditEvents.unshift(event);
  if(auditEvents.length>250)auditEvents.length=250;
  return clone(event);
}

export function assertRestrictedClinicalAccess(context){
  const authorization=restrictedAuthorizationProjection({
    actorId:context?.actor?.id,
    patientId:context?.patient?.id,
    purpose:context?.purpose,
    scopes:context?.scopes
  });

  if(!authorization.active){
    recordAudit({
      actorId:context?.actor?.id,
      patientId:context?.patient?.id,
      purpose:context?.purpose,
      operation:RESTRICTED_TOOL,
      decision:'DENY',
      reasonCode:'RESTRICTED_RECORD_ACCESS_DENIED',
      authorization,
      details:{segmentReleased:false}
    });
    throw accessError(
      'Ordinary chart access does not authorize this restricted behavioral-health segment.',
      authorization
    );
  }
  return authorization;
}

export function readRestrictedClinicalInformation(context){
  const authorization=assertRestrictedClinicalAccess(context);
  const record=restrictedRecords[context.patient.id];
  if(!record){
    throw accessError('No restricted clinical segment is available for this patient.',authorization);
  }

  recordAudit({
    actorId:context.actor.id,
    patientId:context.patient.id,
    purpose:context.purpose,
    operation:RESTRICTED_TOOL,
    decision:'ALLOW',
    authorization,
    details:{
      segmentReleased:true,
      source:record.source,
      recordId:record.id
    }
  });

  return {
    evidenceType:'AUTHORITATIVE RESTRICTED PATIENT FACT',
    authoritative:true,
    source:record.source,
    sourceId:record.id,
    category:record.category,
    sensitivity:record.sensitivity,
    recordedAt:record.recordedAt,
    categoriesReleased:[`restricted:${record.category}`],
    authorization:{
      type:authorization.type,
      authorizationId:authorization.authorizationId,
      additionalAuthorizationRequired:true,
      restrictedScopeVerified:true,
      patientAuthorizationVerified:true,
      purposeVerified:true
    },
    record:clone(record.record)
  };
}

export function restrictedClinicalPreflight({context,query=''}={}){
  if(context?.app!=='clinician'||!restrictedClinicalRequestMatches(query)){
    return {applies:false};
  }
  const authorization=restrictedAuthorizationProjection({
    actorId:context.actor.id,
    patientId:context.patient.id,
    purpose:context.purpose,
    scopes:context.scopes
  });

  if(!authorization.active){
    recordAudit({
      actorId:context.actor.id,
      patientId:context.patient.id,
      purpose:context.purpose,
      operation:'copilot-request',
      decision:'DENY',
      reasonCode:'RESTRICTED_RECORD_ACCESS_DENIED',
      authorization,
      details:{
        modelInvoked:false,
        gatewayInvoked:false,
        segmentReleased:false
      }
    });
    return {
      applies:true,
      decision:'BLOCK',
      reasonCodes:['RESTRICTED_RECORD_ACCESS_DENIED'],
      answer:'This clinician has ordinary access to the patient care context, but the separately protected behavioral-health segment requires additional restricted-record authorization and an active patient authorization for this purpose.',
      authorization:{...authorization,segmentReleased:false}
    };
  }

  recordAudit({
    actorId:context.actor.id,
    patientId:context.patient.id,
    purpose:context.purpose,
    operation:'copilot-request',
    decision:'ALLOW',
    authorization,
    details:{modelInvoked:true,segmentReleaseRequiresTool:true}
  });
  return {
    applies:true,
    decision:'ALLOW',
    reasonCodes:[],
    authorization:{...authorization,segmentReleased:false}
  };
}

export function setRestrictedAuthorizationState({action='reset',actorId=AUTHORIZED_ACTOR_ID}={}){
  if(!['revoke','restore','reset'].includes(action)){
    throw Object.assign(new Error('Unsupported restricted-authorization action.'),{
      status:400,
      code:'INVALID_RESTRICTED_AUTHORIZATION_ACTION'
    });
  }
  authorizationActive=action==='revoke'?false:true;
  const projection=restrictedAuthorizationProjection({
    actorId,
    patientId:DEMO_PATIENT_ID,
    purpose:RESTRICTED_PURPOSE
  });
  recordAudit({
    actorId,
    patientId:DEMO_PATIENT_ID,
    purpose:RESTRICTED_PURPOSE,
    operation:`authorization-${action}`,
    decision:'ALLOW',
    authorization:projection,
    details:{
      authorizationState:authorizationActive?'ACTIVE':'REVOKED',
      segmentReleased:false
    }
  });
  return restrictedClinicalInformationSummary();
}

export function restrictedClinicalAudit({
  actorId=null,
  patientId=null,
  limit=50
}={}){
  const patient=patientId?patients[patientId]:null;
  return auditEvents
    .filter(event=>
      (!actorId||event.actorId===actorId) &&
      (!patient||event.patientPseudonym===patient.pseudonym)
    )
    .slice(0,Math.max(1,Math.min(Number(limit)||50,100)))
    .map(clone);
}

export function resetRestrictedClinicalInformation(){
  authorizationActive=true;
  auditEvents.length=0;
  return restrictedClinicalInformationSummary();
}

function actorSummary(actorId){
  const actor=workforce[actorId];
  const authorization=restrictedAuthorizationProjection({
    actorId,
    patientId:DEMO_PATIENT_ID,
    purpose:RESTRICTED_PURPOSE
  });
  return {
    actorId,
    display:actor?.display||actorId,
    role:actor?.role||null,
    specialty:actor?.specialty||null,
    ordinaryChartAccess:authorization.ordinaryChartAccess,
    careRelationship:authorization.careRelationship,
    restrictedAuthorization:authorization
  };
}

export function restrictedClinicalInformationSummary(){
  const patient=patients[DEMO_PATIENT_ID];
  return {
    patient:{
      id:patient.id,
      display:patient.name,
      pseudonym:patient.pseudonym
    },
    category:{
      id:RESTRICTED_CATEGORY,
      label:'Behavioral Health',
      sensitivity:'RESTRICTED',
      source:RESTRICTED_SOURCE
    },
    authorization:{
      authorizationId:baselineAuthorization.authorizationId,
      active:authorizationCurrentlyValid(),
      basis:baselineAuthorization.basis,
      effectiveAt:baselineAuthorization.effectiveAt,
      expiresAt:baselineAuthorization.expiresAt,
      requiredScope:RESTRICTED_SCOPE,
      requiredPurpose:RESTRICTED_PURPOSE
    },
    ordinaryClinician:actorSummary(ORDINARY_ACTOR_ID),
    restrictedClinician:actorSummary(AUTHORIZED_ACTOR_ID),
    prompt:'Summarize Nadia Rahman’s restricted behavioral-health follow-up record using only authorized evidence.',
    policy:{
      ordinaryChartAccessIsInsufficient:true,
      additionalRestrictedScopeRequired:true,
      activePatientAuthorizationRequired:true,
      purposeBindingRequired:true,
      segmentSeparatedFromOrdinaryChart:true
    },
    principle:'Having access to the patient does not mean having access to every category of information about the patient.',
    audit:restrictedClinicalAudit({patientId:DEMO_PATIENT_ID,limit:20})
  };
}
