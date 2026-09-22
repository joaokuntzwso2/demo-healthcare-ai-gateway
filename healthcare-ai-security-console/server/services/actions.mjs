import crypto from 'node:crypto';
import { minimizedPatientView } from './minimization.mjs';
import { evaluateMedicationRequest } from './clinical-safety.mjs';
import { AccessError } from './context.mjs';
const actionRequests=new Map();
const APPROVAL_KEY=process.env.HELIOS_APPROVAL_KEY||'helios-demo-only-approval-key';
const sig=x=>crypto.createHmac('sha256',APPROVAL_KEY).update(x).digest('hex');
export function requestMedicationOrder(context,{medication,dose,unit='demo-units'}={}){
  if(context.app!=='clinician'||!context.scopes.includes('clinical-action:request')) throw new AccessError('CLINICAL_DATA_NOT_AUTHORIZED','Clinical action request scope is required.');
  if(!medication||dose==null) throw new AccessError('REQUIRED_CLINICAL_CONTEXT_MISSING','Medication and dose are required.',400);
  const view=minimizedPatientView({...context,purpose:'medication-review'},'medication-review');
  const safety=evaluateMedicationRequest({medication,dose,unit,patientView:view});
  const id=crypto.randomUUID(); const req={id,type:'MEDICATION_ORDER_REQUEST',tenant:context.tenant,patientPseudonym:context.patient.pseudonym,requestedBy:context.actor.id,medication,dose,unit,status:safety.decision==='DO_NOT_ADVANCE'?'SAFETY_HOLD':'PENDING_CLINICIAN_APPROVAL',safety,createdAt:new Date().toISOString(),executed:false};
  actionRequests.set(id,req); return req;
}
export function requestTestOrder(context,{testCode}={}){
  if(context.app!=='clinician'||!context.scopes.includes('clinical-action:request')) throw new AccessError('CLINICAL_DATA_NOT_AUTHORIZED','Clinical action request scope is required.');
  if(!testCode) throw new AccessError('REQUIRED_CLINICAL_CONTEXT_MISSING','Test code is required.',400);
  const id=crypto.randomUUID(); const req={id,type:'TEST_ORDER_REQUEST',tenant:context.tenant,patientPseudonym:context.patient.pseudonym,requestedBy:context.actor.id,testCode,status:'PENDING_CLINICIAN_APPROVAL',createdAt:new Date().toISOString(),executed:false}; actionRequests.set(id,req); return req;
}
export function createApprovalChallenge(context, actionId){
  const req=actionRequests.get(actionId); if(!req) throw new AccessError('CLINICIAN_APPROVAL_REQUIRED','Unknown clinical action request.',404);
  if(!context.scopes.includes('approval:submit')) throw new AccessError('CLINICIAN_APPROVAL_REQUIRED','Approval scope is required.');
  const exp=Date.now()+5*60000; const payload=`${actionId}|${context.actor.id}|${context.patient.pseudonym}|${exp}`; return {actionId,actor:context.actor.id,expiresAt:new Date(exp).toISOString(),token:`${exp}.${sig(payload)}`};
}
export function submitClinicianApproval(context,{actionId,token}={}){
  const req=actionRequests.get(actionId); if(!req) throw new AccessError('CLINICIAN_APPROVAL_REQUIRED','Unknown clinical action request.',404);
  if(req.patientPseudonym!==context.patient.pseudonym||req.tenant!==context.tenant) throw new AccessError('PATIENT_SCOPE_MISMATCH','Approval is not bound to this patient/tenant.');
  if(req.status==='SAFETY_HOLD') throw new AccessError(req.safety.reasonCodes[0]||'CLINICIAN_APPROVAL_REQUIRED','Synthetic safety hold must be resolved before approval.');
  const [expText,signature]=String(token||'').split('.'); const exp=Number(expText); const payload=`${actionId}|${context.actor.id}|${context.patient.pseudonym}|${exp}`;
  if(!exp||Date.now()>exp||signature!==sig(payload)) throw new AccessError('CLINICIAN_APPROVAL_REQUIRED','Forged, expired, or context-mismatched clinician approval denied.');
  req.status='APPROVED_REQUEST_NOT_EXECUTED'; req.approvedBy=context.actor.id; req.approvedAt=new Date().toISOString(); req.executed=false; return req;
}
export function getAction(id){return actionRequests.get(id)||null;}
