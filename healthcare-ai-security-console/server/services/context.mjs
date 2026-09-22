import crypto from 'node:crypto';
import { patients, workforce, patientSupportUsers, encountersById } from '../data/synthetic-healthcare.mjs';

const HMAC_KEY = process.env.HELIOS_PSEUDONYM_KEY || 'helios-demo-only-pseudonym-key';
export function pseudonymize(value){ return 'PX-' + crypto.createHmac('sha256', HMAC_KEY).update(String(value)).digest('hex').slice(0,12).toUpperCase(); }
export class AccessError extends Error { constructor(code, message, status=403){ super(message); this.code=code; this.status=status; } }

export function resolveClinicianContext({ actorId='clin-001', patientId='pat-1001', encounterId='enc-501', purpose='encounter-summary', requestedScopes=[] }={}) {
  const actor = workforce[actorId];
  const patient = patients[patientId];
  if (!actor || !patient) throw new AccessError('CLINICAL_DATA_NOT_AUTHORIZED','Unknown workforce actor or patient.');
  if (actor.tenant !== patient.tenant) throw new AccessError('PATIENT_SCOPE_MISMATCH','Cross-tenant patient access denied.');
  const encounter = encounterId ? encountersById[encounterId] : null;
  if (encounterId && (!encounter || encounter.patient !== patient.id || encounter.tenant !== actor.tenant)) throw new AccessError('PATIENT_SCOPE_MISMATCH','Encounter is not bound to the authorized patient and tenant.');
  const scopes = requestedScopes.length ? requestedScopes.filter(s => actor.scopes.includes(s)) : [...actor.scopes];
  return { tenant:actor.tenant, actor:{id:actor.id,display:actor.display,role:actor.role}, patient:{id:patient.id,pseudonym:patient.pseudonym}, encounter:encounter?.id || null, purpose, scopes, app:'clinician', permittedDataCategories:[] };
}

export function resolvePatientSupportContext({ userId='portal-1001', patientId, purpose='patient-support' }={}){
  const user = patientSupportUsers[userId];
  if (!user) throw new AccessError('CLINICAL_DATA_NOT_AUTHORIZED','Unknown patient-support identity.');
  const effectivePatient = patientId || user.patient;
  if (effectivePatient !== user.patient) throw new AccessError('PATIENT_SCOPE_MISMATCH','Patient-support identity may only access its own patient context.');
  const patient = patients[user.patient];
  if (!patient || patient.tenant !== user.tenant) throw new AccessError('PATIENT_SCOPE_MISMATCH','Patient tenant binding failed.');
  return {tenant:user.tenant,actor:{id:user.id,display:'Synthetic Patient Portal User',role:'patient'},patient:{id:patient.id,pseudonym:patient.pseudonym},encounter:null,purpose,scopes:[...user.scopes],app:'patient-support',permittedDataCategories:['appointments','approvedInstructions','education']};
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
