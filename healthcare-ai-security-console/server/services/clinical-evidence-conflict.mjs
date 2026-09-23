import { patients } from '../data/synthetic-healthcare.mjs';

const DEMO_PATIENT_ID='pat-1001';

const claims=[
  {
    claimId:'medclaim-home-lisinopril-10',
    medicationKey:'lisinopril',
    medicationDisplay:'Lisinopril',
    dose:{value:10,unit:'mg'},
    route:'oral',
    frequency:'daily',
    status:'active',
    sourceId:'HOME-MEDICATION-LIST',
    sourceDisplay:'Home Medication List',
    sourceSystem:'EHR_HOME_MEDICATIONS',
    recordedAt:'2026-09-16T09:15:00Z',
    provenance:'Patient-reported/home medication workflow',
    authorityClass:'authoritative-source-claim'
  },
  {
    claimId:'medclaim-discharge-lisinopril-20',
    medicationKey:'lisinopril',
    medicationDisplay:'Lisinopril',
    dose:{value:20,unit:'mg'},
    route:'oral',
    frequency:'daily',
    status:'active',
    sourceId:'DISCHARGE-MEDICATION-RECONCILIATION',
    sourceDisplay:'Discharge Medication Reconciliation',
    sourceSystem:'EHR_DISCHARGE_MED_REC',
    recordedAt:'2026-09-17T16:40:00Z',
    provenance:'Discharge medication reconciliation workflow',
    authorityClass:'authoritative-source-claim'
  }
];

function clone(v){return JSON.parse(JSON.stringify(v));}

function conflictForPatient(patientId){
  if(patientId!==DEMO_PATIENT_ID)return null;
  const patient=patients[patientId];
  if(!patient)return null;
  return {
    conflictId:'medconflict-lisinopril-dose',
    type:'MEDICATION_DOSE_CONFLICT',
    status:'CONFLICT',
    medicationKey:'lisinopril',
    medicationDisplay:'Lisinopril',
    patientPseudonym:patient.pseudonym,
    field:'dose',
    claims:clone(claims),
    reconciliation:{
      state:'UNRESOLVED',
      authoritativeWinner:null,
      rule:'SURFACE_ALL_AUTHORITATIVE_CLAIMS',
      clinicalAction:'CLINICIAN_RECONCILIATION_REQUIRED',
      rationale:'Recency alone does not establish the clinically correct medication dose.'
    },
    advisoryCode:'CLINICAL_EVIDENCE_CONFLICT'
  };
}

export function medicationEvidenceForPatient(patientId){
  const conflict=conflictForPatient(patientId);
  if(!conflict){
    return {
      status:'CONSISTENT',
      conflicts:[],
      claims:[],
      advisoryCodes:[]
    };
  }
  return {
    status:'CONFLICT',
    conflicts:[conflict],
    claims:clone(conflict.claims),
    advisoryCodes:['CLINICAL_EVIDENCE_CONFLICT']
  };
}

export function clinicalEvidenceConflictSummary(patientId=DEMO_PATIENT_ID){
  const patient=patients[patientId];
  if(!patient)return null;
  const evidence=medicationEvidenceForPatient(patientId);
  return {
    patient:{
      display:patient.name,
      pseudonym:patient.pseudonym
    },
    evidenceType:'AUTHORITATIVE MULTI-SOURCE CLINICAL EVIDENCE',
    source:'MEDICATION-RECONCILIATION',
    medicationEvidence:evidence,
    policy:{
      silentResolutionAllowed:false,
      recencyAloneMaySelectWinner:false,
      sourceProvenanceRequired:true,
      unresolvedConflictRequiresHumanReconciliation:true
    }
  };
}

export function deterministicConflictNarrative(evidenceOrConflict){
  const conflict=Array.isArray(evidenceOrConflict?.conflicts)
    ? evidenceOrConflict.conflicts[0]
    : evidenceOrConflict?.type==='MEDICATION_DOSE_CONFLICT'
      ? evidenceOrConflict
      : null;

  if(!conflict)return null;
  const home=conflict.claims.find(x=>x.sourceId==='HOME-MEDICATION-LIST');
  const discharge=conflict.claims.find(x=>x.sourceId==='DISCHARGE-MEDICATION-RECONCILIATION');
  if(!home||!discharge)return null;

  return [
    'Conflicting medication evidence detected.',
    `${home.sourceDisplay} reports ${home.medicationDisplay} ${home.dose.value} ${home.dose.unit} ${home.frequency}.`,
    `${discharge.sourceDisplay} reports ${discharge.medicationDisplay} ${discharge.dose.value} ${discharge.dose.unit} ${discharge.frequency}.`,
    'Helios does not select either dose as the current truth because the authoritative sources disagree and no completed reconciliation decision is available.',
    'Clinician medication reconciliation is required before relying on a single dose.'
  ].join(' ');
}

export function firstMedicationConflictFromEvidence(evidence=[]){
  for(const item of evidence||[]){
    const conflicts=item?.medicationEvidence?.conflicts;
    if(Array.isArray(conflicts)&&conflicts.length)return clone(conflicts[0]);
  }
  return null;
}
