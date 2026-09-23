import { patients } from '../data/synthetic-healthcare.mjs';
import { labFreshnessSummary } from './lab-result-lineage.mjs';

const DEFAULT_PATIENT_ID='pat-1001';

const SEPSIS_REQUIRED_CONTEXT=[
  {
    id:'current-vital-signs',
    label:'Current vital signs',
    category:'VITALS',
    required:true,
    available:false,
    status:'UNAVAILABLE',
    expectedExamples:[
      'temperature',
      'heart rate',
      'respiratory rate',
      'blood pressure',
      'oxygen saturation'
    ],
    sourceSystem:'VITALS-SERVICE',
    reasonCode:'CURRENT_VITAL_SIGNS_UNAVAILABLE'
  },
  {
    id:'blood-culture-results',
    label:'Blood culture results',
    category:'MICROBIOLOGY',
    required:true,
    available:false,
    status:'UNAVAILABLE',
    expectedExamples:[
      'blood culture collection/result',
      'organism/no-growth status',
      'collection/result timestamps'
    ],
    sourceSystem:'MICROBIOLOGY-SERVICE',
    reasonCode:'BLOOD_CULTURE_RESULTS_UNAVAILABLE'
  }
];

function clone(v){return JSON.parse(JSON.stringify(v));}

export function isSepsisAssessmentQuestion(query=''){
  return /\b(?:sepsis|septic\s+shock|septic)\b/i.test(String(query||''));
}

export function sepsisContextCompleteness(patientId=DEFAULT_PATIENT_ID){
  const patient=patients[patientId];
  if(!patient)return null;

  const freshness=labFreshnessSummary(patientId);
  const potassium=freshness?.currentResult||null;
  const required=clone(SEPSIS_REQUIRED_CONTEXT);
  const missing=required.filter(x=>x.required&&!x.available);

  const supportingEvidence=[];
  if(potassium){
    supportingEvidence.push({
      category:'LAB',
      source:'LAB-SYSTEM',
      label:'Current corrected potassium',
      value:potassium.value,
      unit:potassium.unit,
      resultVersionId:potassium.resultVersionId,
      version:potassium.version,
      status:potassium.status,
      sufficientForDiagnosticConclusion:false
    });
  }

  return {
    assessment:'SEPSIS_DIAGNOSTIC_CONTEXT',
    patient:{
      display:patient.name,
      pseudonym:patient.pseudonym
    },
    completeness:missing.length?'INCOMPLETE':'COMPLETE',
    diagnosticConclusionAllowed:missing.length===0,
    requiredContext:required,
    missingContext:missing.map(x=>({
      id:x.id,
      label:x.label,
      category:x.category,
      sourceSystem:x.sourceSystem,
      reasonCode:x.reasonCode
    })),
    supportingEvidence,
    policy:{
      highStakesDiagnosticQuestion:true,
      requireCompleteAuthoritativeContext:true,
      inferMissingVitals:false,
      inferMissingCultures:false,
      modelMayFillMissingClinicalFacts:false,
      abstainWhenRequiredContextMissing:true
    }
  };
}

export function gracefulAbstentionPreflight({
  query='',
  patientId=DEFAULT_PATIENT_ID
}={}){
  if(!isSepsisAssessmentQuestion(query)){
    return {applies:false};
  }

  const context=sepsisContextCompleteness(patientId);
  if(!context){
    return {
      applies:true,
      decision:'ABSTAIN',
      reasonCodes:[
        'REQUIRED_CLINICAL_CONTEXT_MISSING',
        'PATIENT_CONTEXT_UNAVAILABLE'
      ],
      answer:'Helios cannot evaluate this high-stakes diagnostic question because the authoritative patient context is unavailable.',
      clinicalContextCompleteness:null,
      safetyDecision:{
        type:'DETERMINISTIC_CONTEXT_COMPLETENESS_GATE',
        status:'ABSTAIN',
        diagnosticConclusionAllowed:false,
        modelInvoked:false,
        gatewayInvoked:false
      }
    };
  }

  if(context.diagnosticConclusionAllowed){
    return {
      applies:true,
      decision:'CONTINUE',
      reasonCodes:[],
      clinicalContextCompleteness:context
    };
  }

  const missingCodes=context.missingContext.map(x=>x.reasonCode);

  return {
    applies:true,
    decision:'ABSTAIN',
    reasonCodes:[
      'REQUIRED_CLINICAL_CONTEXT_MISSING',
      ...missingCodes
    ],
    answer:[
      'Helios cannot determine whether this patient has sepsis from the available authoritative data.',
      'Current vital signs and blood-culture results required by this demonstration’s clinical-context completeness policy are unavailable.',
      'The system abstained rather than infer missing clinical facts or manufacture a diagnostic conclusion.'
    ].join(' '),
    clinicalContextCompleteness:context,
    safetyDecision:{
      type:'DETERMINISTIC_CONTEXT_COMPLETENESS_GATE',
      status:'ABSTAIN',
      questionClass:'HIGH_STAKES_DIAGNOSTIC',
      diagnosticTarget:'SEPSIS',
      diagnosticConclusionAllowed:false,
      missingRequiredContext:context.missingContext.map(x=>x.id),
      modelInvoked:false,
      gatewayInvoked:false,
      rationale:'Required authoritative diagnostic context is incomplete.'
    }
  };
}

export function gracefulAbstentionDemoSummary(patientId=DEFAULT_PATIENT_ID){
  const context=sepsisContextCompleteness(patientId);
  if(!context)return null;

  return {
    question:'Does this patient have sepsis?',
    expectedDecision:'ABSTAIN',
    reasonCodes:[
      'REQUIRED_CLINICAL_CONTEXT_MISSING',
      ...context.missingContext.map(x=>x.reasonCode)
    ],
    clinicalContextCompleteness:context,
    execution:{
      modelInvoked:false,
      gatewayInvoked:false,
      diagnosisProduced:false
    },
    message:'Good clinical AI knows when required authoritative context is missing and stops before diagnostic inference.'
  };
}
