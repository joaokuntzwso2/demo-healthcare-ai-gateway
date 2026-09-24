import { patients } from '../data/synthetic-healthcare.mjs';
import { validateRequestedPatient, AccessError } from './context.mjs';
import { minimizedPatientView, assertCategoryAllowed } from './minimization.mjs';
import { searchKnowledge } from './knowledge.mjs';
import { evaluateMedicationRequest } from './clinical-safety.mjs';
import { requestMedicationOrder, requestTestOrder, submitClinicianApproval } from './actions.mjs';
import { buildFhirEnvelope } from './fhir-adapter.mjs';
import { encounterWithLifecycle } from './encounter-lifecycle.mjs';
import { assertToolAllowedForPurpose, allowedClinicianToolsForPurpose, schedulingProjection } from './purpose-of-use.mjs';
import { medicationEvidenceForPatient } from './clinical-evidence-conflict.mjs';
import { applyCurrentLabProjection } from './lab-result-lineage.mjs';
import { RESTRICTED_TOOL, assertRestrictedClinicalAccess, readRestrictedClinicalInformation, restrictedAuthorizationProjection } from './restricted-clinical-information.mjs';

export const clinicianTools=['get_patient_summary','get_encounter','get_recent_labs','get_medications','get_allergies','get_conditions','search_clinical_knowledge','check_medication_safety','draft_clinical_note','request_medication_order','request_test_order','submit_for_clinician_approval','get_scheduling_context',RESTRICTED_TOOL];
export const patientTools=['get_own_appointment','get_own_approved_instructions','search_patient_education','request_callback'];
const requireScope=(ctx,s)=>{if(!ctx.scopes.includes(s))throw new AccessError('CLINICAL_DATA_NOT_AUTHORIZED',`Scope ${s} required.`)};
export function allowedTools(context){
  if(context.app!=='clinician')return [...patientTools];
  const tools=allowedClinicianToolsForPurpose(context,clinicianTools);
  const restricted=restrictedAuthorizationProjection({actorId:context.actor?.id,patientId:context.patient?.id,purpose:context.purpose,scopes:context.scopes});
  return restricted.active?tools:tools.filter(name=>name!==RESTRICTED_TOOL);
}
function withFhir(context,name,patient,result){const fhir=buildFhirEnvelope({context,name,patient,result});return fhir?{...result,fhir}:result;}
export function executeTool(context,name,args={}){
 if(context.app==='clinician')assertToolAllowedForPurpose(context,name);
 if(context.app==='clinician'&&name===RESTRICTED_TOOL)assertRestrictedClinicalAccess(context);
 if(!allowedTools(context).includes(name)) throw new AccessError('CLINICAL_DATA_NOT_AUTHORIZED',`Tool ${name} is not available to ${context.app}.`);
 validateRequestedPatient(context,args.patientId);
 const patient=patients[context.patient.id];
 let result;
 switch(name){
  case 'get_scheduling_context': result={evidenceType:'AUTHORITATIVE SCHEDULING FACT',...schedulingProjection(patient)}; break;
  case 'get_patient_summary': {
    requireScope(context,'chart:summary');
    const view=minimizedPatientView({...context,purpose:'encounter-summary'},'encounter-summary');
    result={evidenceType:'AUTHORITATIVE PATIENT FACT',source:'trusted-clinical-resources',...view};
    if(context.careRelationship?.dynamic){
      result.currentCareContext={
        authority:'CARE-RELATIONSHIP-AUTHORITY',
        relationshipType:'current-care-ownership',
        phaseId:context.careRelationship.phaseId,
        phaseLabel:context.careRelationship.phaseLabel,
        careSetting:context.careRelationship.careSetting,
        service:context.careRelationship.service,
        currentOwnerActorId:context.careRelationship.currentOwnerActorId,
        phaseStartedAt:context.careRelationship.phaseStartedAt,
        relationshipVersion:context.careRelationship.relationshipVersion
      };
      result.encounters=(result.encounters||[]).map(encounter=>({
        ...encounter,
        careContextRelevance:'recent-documented-encounter; not the authoritative current care-owner relationship'
      }));
    }
    if(context.breakGlass?.active){
      result.emergencyAccessContext={
        mode:'break-glass',
        active:true,
        temporary:true,
        stepUpVerified:true,
        stepUpMethod:context.breakGlass.stepUpMethod,
        expiresAt:context.breakGlass.expiresAt,
        auditSeverity:'HIGH',
        normalRelationshipActive:false
      };
    }
    const summaryMedicationEvidence=medicationEvidenceForPatient(patient.id);
    if(summaryMedicationEvidence.status==='CONFLICT'){
      result.medicationEvidence=summaryMedicationEvidence;
      result.conflicts=summaryMedicationEvidence.conflicts;
      result.advisoryCodes=[...new Set([...(result.advisoryCodes||[]),...summaryMedicationEvidence.advisoryCodes])];
    }
        const labProjection=applyCurrentLabProjection(patient.id,result.labs||patient.labs||[]);
    result.labs=labProjection.labs;
    result.labResultLineage=labProjection.labResultLineage;
    result.advisoryCodes=[...new Set([...(result.advisoryCodes||[]),...labProjection.advisoryCodes])];
    break;
  }
  case 'get_encounter': requireScope(context,'chart:summary'); assertCategoryAllowed({...context,purpose:'encounter-summary'},'encounters'); result={evidenceType:'AUTHORITATIVE PATIENT FACT',source:'EHR-ENCOUNTERS',encounter:encounterWithLifecycle(patient.encounters.find(e=>e.id===(args.encounterId||context.encounter))||null)}; break;
  case 'get_recent_labs': {
    requireScope(context,'labs:read');
    const projected=applyCurrentLabProjection(patient.id,patient.labs);
    result={
      evidenceType:'AUTHORITATIVE PATIENT FACT',
      source:'LAB-SYSTEM',
      labs:projected.labs,
      labResultLineage:projected.labResultLineage,
      advisoryCodes:projected.advisoryCodes
    };
    break;
  }
  case 'get_medications': {
    requireScope(context,'medications:read');
    const medicationEvidence=medicationEvidenceForPatient(patient.id);
    result={
      evidenceType:'AUTHORITATIVE PATIENT FACT',
      source:medicationEvidence.status==='CONFLICT'?'MULTI-SOURCE-MEDICATION-RECONCILIATION':'EHR-MEDICATIONS',
      medications:patient.medications,
      medicationEvidence,
      conflicts:medicationEvidence.conflicts,
      advisoryCodes:medicationEvidence.advisoryCodes
    };
    break;
  }
  case 'get_allergies': requireScope(context,'allergies:read'); result={evidenceType:'AUTHORITATIVE PATIENT FACT',source:'EHR-ALLERGIES',allergies:patient.allergies}; break;
  case 'get_conditions': requireScope(context,'conditions:read'); result={evidenceType:'AUTHORITATIVE PATIENT FACT',source:'EHR-CONDITIONS',conditions:patient.conditions}; break;
  case RESTRICTED_TOOL: return readRestrictedClinicalInformation(context);
  case 'search_clinical_knowledge': requireScope(context,'knowledge:read'); return {evidenceType:'CLINICAL KNOWLEDGE SOURCE',sources:searchKnowledge(context,args.query||'')};
  case 'check_medication_safety': requireScope(context,'medication-safety:read'); {const view=minimizedPatientView({...context,purpose:'medication-review'},'medication-review'); return {evidenceType:'DETERMINISTIC SAFETY DECISION',...evaluateMedicationRequest({medication:args.medication,dose:args.dose,unit:args.unit,patientView:view})};}
  case 'draft_clinical_note': requireScope(context,'note:draft'); {const view=minimizedPatientView({...context,purpose:'note-drafting'},'note-drafting');return {evidenceType:'MODEL-GENERATED TEXT',authoritative:false,draft:`DRAFT — SYNTHETIC DEMO. Encounter ${context.encounter||'not specified'}; available categories: ${view.categoriesReleased.join(', ')}. Clinician must review and edit before any chart use.`};}
  case 'request_medication_order': return requestMedicationOrder(context,args);
  case 'request_test_order': return requestTestOrder(context,args);
  case 'submit_for_clinician_approval': return submitClinicianApproval(context,args);
  case 'get_own_appointment': result={evidenceType:'AUTHORITATIVE PATIENT FACT',source:'SCHEDULING',appointments:patient.appointments}; break;
  case 'get_own_approved_instructions': return {evidenceType:'AUTHORITATIVE PATIENT FACT',source:'PATIENT-INSTRUCTIONS',instructions:patient.approvedInstructions};
  case 'search_patient_education': return {evidenceType:'CLINICAL KNOWLEDGE SOURCE',sources:searchKnowledge(context,args.query||'',{educationOnly:true})};
  case 'request_callback': return {evidenceType:'DETERMINISTIC WORKFLOW RESULT',requestId:`callback-${Date.now()}`,status:'QUEUED_DEMO',patientPseudonym:patient.pseudonym,noClinicalAction:true};
  default: throw new AccessError('CLINICAL_DATA_NOT_AUTHORIZED','Unsupported tool.');
 }
 return withFhir(context,name,patient,result);
}
