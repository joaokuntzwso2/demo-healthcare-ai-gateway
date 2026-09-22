import { patients } from '../data/synthetic-healthcare.mjs';
import { validateRequestedPatient, AccessError } from './context.mjs';
import { minimizedPatientView, assertCategoryAllowed } from './minimization.mjs';
import { searchKnowledge } from './knowledge.mjs';
import { evaluateMedicationRequest } from './clinical-safety.mjs';
import { requestMedicationOrder, requestTestOrder, submitClinicianApproval } from './actions.mjs';

export const clinicianTools=['get_patient_summary','get_encounter','get_recent_labs','get_medications','get_allergies','get_conditions','search_clinical_knowledge','check_medication_safety','draft_clinical_note','request_medication_order','request_test_order','submit_for_clinician_approval'];
export const patientTools=['get_own_appointment','get_own_approved_instructions','search_patient_education','request_callback'];
const requireScope=(ctx,s)=>{if(!ctx.scopes.includes(s))throw new AccessError('CLINICAL_DATA_NOT_AUTHORIZED',`Scope ${s} required.`)};
export function allowedTools(context){return context.app==='clinician'?[...clinicianTools]:[...patientTools];}
export function executeTool(context,name,args={}){
 if(!allowedTools(context).includes(name)) throw new AccessError('CLINICAL_DATA_NOT_AUTHORIZED',`Tool ${name} is not available to ${context.app}.`);
 validateRequestedPatient(context,args.patientId);
 const patient=patients[context.patient.id];
 switch(name){
  case 'get_patient_summary': requireScope(context,'chart:summary'); return {evidenceType:'AUTHORITATIVE PATIENT FACT',source:'trusted-clinical-resources',...minimizedPatientView({...context,purpose:'encounter-summary'},'encounter-summary')};
  case 'get_encounter': requireScope(context,'chart:summary'); assertCategoryAllowed({...context,purpose:'encounter-summary'},'encounters'); return {evidenceType:'AUTHORITATIVE PATIENT FACT',source:'EHR-ENCOUNTERS',encounter:patient.encounters.find(e=>e.id===(args.encounterId||context.encounter))||null};
  case 'get_recent_labs': requireScope(context,'labs:read'); return {evidenceType:'AUTHORITATIVE PATIENT FACT',source:'LAB-SYSTEM',labs:patient.labs.slice(0,5)};
  case 'get_medications': requireScope(context,'medications:read'); return {evidenceType:'AUTHORITATIVE PATIENT FACT',source:'EHR-MEDICATIONS',medications:patient.medications};
  case 'get_allergies': requireScope(context,'allergies:read'); return {evidenceType:'AUTHORITATIVE PATIENT FACT',source:'EHR-ALLERGIES',allergies:patient.allergies};
  case 'get_conditions': requireScope(context,'conditions:read'); return {evidenceType:'AUTHORITATIVE PATIENT FACT',source:'EHR-CONDITIONS',conditions:patient.conditions};
  case 'search_clinical_knowledge': requireScope(context,'knowledge:read'); return {evidenceType:'CLINICAL KNOWLEDGE SOURCE',sources:searchKnowledge(context,args.query||'')};
  case 'check_medication_safety': requireScope(context,'medication-safety:read'); {const view=minimizedPatientView({...context,purpose:'medication-review'},'medication-review'); return {evidenceType:'DETERMINISTIC SAFETY DECISION',...evaluateMedicationRequest({medication:args.medication,dose:args.dose,unit:args.unit,patientView:view})};}
  case 'draft_clinical_note': requireScope(context,'note:draft'); {const view=minimizedPatientView({...context,purpose:'note-drafting'},'note-drafting');return {evidenceType:'MODEL-GENERATED TEXT',authoritative:false,draft:`DRAFT — SYNTHETIC DEMO. Encounter ${context.encounter||'not specified'}; available categories: ${view.categoriesReleased.join(', ')}. Clinician must review and edit before any chart use.`};}
  case 'request_medication_order': return requestMedicationOrder(context,args);
  case 'request_test_order': return requestTestOrder(context,args);
  case 'submit_for_clinician_approval': return submitClinicianApproval(context,args);
  case 'get_own_appointment': return {evidenceType:'AUTHORITATIVE PATIENT FACT',source:'SCHEDULING',appointments:patient.appointments};
  case 'get_own_approved_instructions': return {evidenceType:'AUTHORITATIVE PATIENT FACT',source:'PATIENT-INSTRUCTIONS',instructions:patient.approvedInstructions};
  case 'search_patient_education': return {evidenceType:'CLINICAL KNOWLEDGE SOURCE',sources:searchKnowledge(context,args.query||'',{educationOnly:true})};
  case 'request_callback': return {evidenceType:'DETERMINISTIC WORKFLOW RESULT',requestId:`callback-${Date.now()}`,status:'QUEUED_DEMO',patientPseudonym:patient.pseudonym,noClinicalAction:true};
  default: throw new AccessError('CLINICAL_DATA_NOT_AUTHORIZED','Unsupported tool.');
 }
}
