import crypto from 'node:crypto';
import { patients, workforce, patientSupportUsers, encountersById, careAssignments, isClinicianAssignedToPatient } from '../data/synthetic-healthcare.mjs';
import { encounterAccessDecision } from './encounter-lifecycle.mjs';
import { careRelationshipDecision } from './care-team-handoff.mjs';
import { activeBreakGlassGrant, recordBreakGlassUse } from './break-glass.mjs';
import { restrictedAuthorizationProjection } from './restricted-clinical-information.mjs';

import { tenantBoundaryDecision, recordTenantBoundaryAudit } from './multi-tenant-isolation.mjs';
const HMAC_KEY = process.env.HELIOS_PSEUDONYM_KEY || 'helios-demo-only-pseudonym-key';
export function pseudonymize(value){ return 'PX-' + crypto.createHmac('sha256', HMAC_KEY).update(String(value)).digest('hex').slice(0,12).toUpperCase(); }
export class AccessError extends Error { constructor(code, message, status=403){ super(message); this.code=code; this.status=status; } }

export function resolveClinicianContext({ actorId='clin-001', patientId='pat-1001', encounterId='enc-501', purpose='encounter-summary', requestedScopes=[] }={}) {
  const actor = workforce[actorId];
  const patient = patients[patientId];
  if (!actor || !patient) throw new AccessError('CLINICAL_DATA_NOT_AUTHORIZED','Unknown workforce actor or patient.');
  const tenantDecision=tenantBoundaryDecision({actorTenant:actor.tenant,patientTenant:patient.tenant,requestedTenant:patient.tenant});
  if(!tenantDecision.allowed){recordTenantBoundaryAudit({event:'TENANT_CONTEXT_BINDING_DENIED',actorId:actor.id,actorTenant:actor.tenant,requestedTenant:patient.tenant,patientTenant:patient.tenant,decision:'BLOCKED',reasonCode:'TENANT_BOUNDARY_VIOLATION'});throw new AccessError('TENANT_BOUNDARY_VIOLATION','Clinical data access across healthcare-organization boundaries is denied.');}
  const relationship=careRelationshipDecision({actorId:actor.id,patientId:patient.id});
  const emergencyGrant=relationship.allowed?null:activeBreakGlassGrant({actorId:actor.id,patientId:patient.id});
  if (!relationship.allowed && !emergencyGrant) {
    if(actor.role==='emergency-physician'){
      throw new AccessError('BREAK_GLASS_REQUIRED',`${actor.display} is not assigned to this patient. Explicit emergency reason and verified step-up authentication are required.`);
    }
    throw new AccessError(relationship.code, relationship.message);
  }
  if(emergencyGrant){
    recordBreakGlassUse({grantId:emergencyGrant.grantId,actorId:actor.id,patientId:patient.id,purpose});
  }
  const effectiveRelationship=emergencyGrant?{
    allowed:true,
    code:null,
    message:null,
    source:'break-glass-emergency',
    assignedPatientIds:[...new Set([...(relationship.assignedPatientIds||[]),patient.id])],
    context:{
      ...(relationship.context||{}),
      patientId:patient.id,
      active:true,
      emergencyAccess:true,
      normalRelationshipActive:false,
      source:'break-glass-emergency',
      grantId:emergencyGrant.grantId,
      expiresAt:emergencyGrant.expiresAt,
      severity:'HIGH'
    }
  }:relationship;
  const encounter = encounterId ? encountersById[encounterId] : null;
  if (encounterId && (!encounter || encounter.patient !== patient.id || encounter.tenant !== actor.tenant)) throw new AccessError('PATIENT_SCOPE_MISMATCH','Encounter is not bound to the authorized patient and tenant.');
  let encounterAccess=null;
  if(encounter){
    const decision=encounterAccessDecision({actorId:actor.id,encounterId:encounter.id});
    if(!decision.allowed) throw new AccessError(decision.code,decision.message);
    encounterAccess=decision.context;
  }
  const scopes = requestedScopes.length ? requestedScopes.filter(s => actor.scopes.includes(s)) : [...actor.scopes];
  const restrictedAuthorization=restrictedAuthorizationProjection({actorId:actor.id,patientId:patient.id,purpose,scopes});
  return { tenant:actor.tenant, actor:{id:actor.id,display:actor.display,role:actor.role}, patient:{id:patient.id,pseudonym:patient.pseudonym,tenant:patient.tenant}, tenantBoundary:{actorTenant:actor.tenant,patientTenant:patient.tenant,requestedTenant:patient.tenant,sameTenant:true,policy:'STRICT_TENANT_ISOLATION',version:'tenant-boundary-v1'}, encounter:encounter?.id || null, encounterAccess, careRelationship:effectiveRelationship.context||null, breakGlass:emergencyGrant?{active:true,mode:'break-glass',grantId:emergencyGrant.grantId,reason:emergencyGrant.reason,stepUpMethod:emergencyGrant.stepUpMethod,grantedAt:emergencyGrant.grantedAt,expiresAt:emergencyGrant.expiresAt,severity:'HIGH'}:null, restrictedAuthorization, purpose, scopes, app:'clinician', patientAssignment:{assigned:true,source:effectiveRelationship.source,assignedPatientIds:[...effectiveRelationship.assignedPatientIds],careRelationship:effectiveRelationship.context||null}, permittedDataCategories:[] };
}

export function resolvePatientSupportContext({ userId='portal-1001', patientId, purpose='patient-support' }={}){
  const user = patientSupportUsers[userId];
  if (!user) throw new AccessError('CLINICAL_DATA_NOT_AUTHORIZED','Unknown patient-support identity.');
  const effectivePatient = patientId || user.patient;
  if (effectivePatient !== user.patient) throw new AccessError('PATIENT_SCOPE_MISMATCH','Patient-support identity may only access its own patient context.');
  const patient = patients[user.patient];
  if (!patient || patient.tenant !== user.tenant) throw new AccessError('TENANT_BOUNDARY_VIOLATION','Patient-support tenant binding failed.');
  return {tenant:user.tenant,actor:{id:user.id,display:user.display||'Synthetic Patient Portal User',role:'patient'},patient:{id:patient.id,pseudonym:patient.pseudonym,tenant:patient.tenant},tenantBoundary:{actorTenant:user.tenant,patientTenant:patient.tenant,requestedTenant:patient.tenant,sameTenant:true,policy:'STRICT_TENANT_ISOLATION',version:'tenant-boundary-v1'},encounter:null,purpose,scopes:[...user.scopes],app:'patient-support',permittedDataCategories:['appointments','approvedInstructions','education']};
}

export function validateRequestedPatient(context, candidatePatientId){
  if (!candidatePatientId) return;
  if (candidatePatientId !== context.patient.id) throw new AccessError('PATIENT_SCOPE_MISMATCH','Model- or client-supplied patient ID does not match server-authorized context.');
}

export function activateBreakGlass(context, {stepUp, reason, durationMinutes=10}={}){
  if (context.app !== 'clinician') throw new AccessError('BREAK_GLASS_REQUIRED','Break-glass is workforce-only.');
  if (stepUp !== 'DEMO-STEP-UP') throw new AccessError('BREAK_GLASS_REQUIRED','Explicit step-up failed.');
  if (!reason || reason.trim().length < 8) throw new AccessError('BREAK_GLASS_REQUIRED','A specific break-glass reason is required.');
  const maxMinutes = Math.min(Math.max(Number(durationMinutes)||10,1),15);
  return {...context,breakGlass:{active:true,reason:reason.trim(),stepUp:true,invokedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+maxMinutes*60000).toISOString(),elevatedAudit:true}};
}
export function assertBreakGlassActive(context){
  if (!context.breakGlass?.active || new Date(context.breakGlass.expiresAt) <= new Date()) throw new AccessError('BREAK_GLASS_REQUIRED','Active, unexpired break-glass authorization is required.');
}
