import { patients } from '../data/synthetic-healthcare.mjs';

const DEMO_PATIENT_ID='pat-1001';
const POTASSIUM_CODE='SYNTH-K';
const RESULT_CHAIN_ID='lab-chain-k-pat1001-20260916';

function clone(v){return JSON.parse(JSON.stringify(v));}

const potassiumVersions=[
  {
    resultVersionId:'lab-k-pat1001-v1',
    chainId:RESULT_CHAIN_ID,
    version:1,
    status:'SUPERSEDED',
    current:false,
    corrected:false,
    code:POTASSIUM_CODE,
    display:'Potassium',
    value:5.8,
    unit:'mmol/L',
    flag:'high',
    observedAt:'2026-09-16T08:00:00Z',
    issuedAt:'2026-09-16T08:05:00Z',
    supersededAt:'2026-09-16T09:20:00Z',
    sourceId:'LAB-SYSTEM',
    sourceSystem:'LAB-SYSTEM',
    sourceRecordId:'LAB-ORD-K-1001-20260916',
    provenance:'Original laboratory result',
    supersededBy:'lab-k-pat1001-v2'
  },
  {
    resultVersionId:'lab-k-pat1001-v2',
    chainId:RESULT_CHAIN_ID,
    version:2,
    status:'CURRENT_CORRECTED',
    current:true,
    corrected:true,
    code:POTASSIUM_CODE,
    display:'Potassium',
    value:4.8,
    unit:'mmol/L',
    flag:'normal',
    observedAt:'2026-09-16T08:00:00Z',
    issuedAt:'2026-09-16T09:20:00Z',
    correctedAt:'2026-09-16T09:20:00Z',
    corrects:'lab-k-pat1001-v1',
    sourceId:'LAB-SYSTEM',
    sourceSystem:'LAB-SYSTEM',
    sourceRecordId:'LAB-ORD-K-1001-20260916',
    provenance:'Laboratory corrected-result amendment'
  }
];

export function labResultLineageForPatient(patientId){
  if(patientId!==DEMO_PATIENT_ID)return {status:'NO_VERSIONED_FIXTURE',resultChains:[],advisoryCodes:[]};
  const patient=patients[patientId];
  if(!patient)return {status:'NO_VERSIONED_FIXTURE',resultChains:[],advisoryCodes:[]};
  const current=potassiumVersions.find(v=>v.current);

  return {
    status:'VERSIONED',
    patientPseudonym:patient.pseudonym,
    resultChains:[{
      chainId:RESULT_CHAIN_ID,
      code:POTASSIUM_CODE,
      display:'Potassium',
      status:'CORRECTED',
      currentVersion:current.version,
      currentResultVersionId:current.resultVersionId,
      versions:clone(potassiumVersions),
      provenance:{
        sourceSystem:'LAB-SYSTEM',
        sourceRecordId:'LAB-ORD-K-1001-20260916',
        eventObservedAt:'2026-09-16T08:00:00Z',
        correctionIssuedAt:'2026-09-16T09:20:00Z'
      },
      selectionRule:{
        rule:'LATEST_VALID_VERSION_IN_RESULT_CHAIN',
        selectedVersion:2,
        selectedValue:4.8,
        selectedUnit:'mmol/L',
        supersededVersionsExcludedFromCurrentFacts:[1]
      }
    }],
    advisoryCodes:['CORRECTED_LAB_RESULT','SUPERSEDED_RESULT_PRESENT']
  };
}

export function applyCurrentLabProjection(patientId,labs=[]){
  if(patientId!==DEMO_PATIENT_ID){
    return {labs:clone(labs||[]),labResultLineage:labResultLineageForPatient(patientId),advisoryCodes:[]};
  }

  const current=potassiumVersions.find(v=>v.current);
  const filtered=(labs||[]).filter(lab=>{
    const code=String(lab?.code||'').toUpperCase();
    const display=String(lab?.display||'').toLowerCase();
    return code!==POTASSIUM_CODE && !display.includes('potassium');
  });

  const currentLab={
    id:current.resultVersionId,
    code:current.code,
    display:current.display,
    value:current.value,
    unit:current.unit,
    observedAt:current.observedAt,
    issuedAt:current.issuedAt,
    correctedAt:current.correctedAt,
    flag:current.flag,
    source:current.sourceId,
    sourceRecordId:current.sourceRecordId,
    resultVersion:current.version,
    resultStatus:current.status,
    current:true,
    corrected:true
  };

  return {
    labs:[currentLab,...clone(filtered)].slice(0,5),
    labResultLineage:labResultLineageForPatient(patientId),
    advisoryCodes:['CORRECTED_LAB_RESULT','SUPERSEDED_RESULT_PRESENT']
  };
}

export function firstCorrectedLabChainFromEvidence(evidence=[]){
  for(const item of evidence||[]){
    const chains=item?.labResultLineage?.resultChains;
    if(Array.isArray(chains)){
      const chain=chains.find(x=>x?.status==='CORRECTED');
      if(chain)return clone(chain);
    }
  }
  return null;
}

export function deterministicFreshnessNarrative(chain){
  if(!chain||chain.status!=='CORRECTED')return null;
  const original=chain.versions.find(v=>v.version===1);
  const corrected=chain.versions.find(v=>v.current===true);
  if(!original||!corrected)return null;

  return [
    `The current potassium result is ${corrected.value} ${corrected.unit}.`,
    `The laboratory originally reported ${original.value} ${original.unit} for the 08:00 result,`,
    `then issued corrected version ${corrected.version} at 09:20 with a value of ${corrected.value} ${corrected.unit}.`,
    `The ${original.value} ${original.unit} value is retained in provenance as superseded and is not treated as the current clinical fact.`,
    'Helios selected the latest valid version in the same laboratory result chain rather than relying on a grounded-but-superseded value.'
  ].join(' ');
}

export function labFreshnessSummary(patientId=DEMO_PATIENT_ID){
  const patient=patients[patientId];
  if(!patient)return null;
  const lineage=labResultLineageForPatient(patientId);
  const chain=lineage.resultChains[0]||null;
  return {
    patient:{display:patient.name,pseudonym:patient.pseudonym},
    evidenceType:'VERSIONED AUTHORITATIVE LAB EVIDENCE',
    source:'LAB-SYSTEM',
    labResultLineage:lineage,
    currentResult:chain?.versions?.find(v=>v.current)||null,
    policy:{
      groundedButSupersededMayBeCurrent:false,
      currentVersionMustBeSelected:true,
      provenanceRequired:true,
      correctionHistoryPreserved:true,
      versionSelectionRule:'LATEST_VALID_VERSION_IN_RESULT_CHAIN'
    }
  };
}
