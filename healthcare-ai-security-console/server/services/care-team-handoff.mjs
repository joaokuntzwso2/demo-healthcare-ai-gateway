import { careAssignments, isClinicianAssignedToPatient, organizations, patients, workforce } from '../data/synthetic-healthcare.mjs';

const DEMO_PATIENT_ID='pat-1003';
const DEFAULT_PHASE_ID='cardiology';
const stateByPatient=new Map();

const PHASES=[
  {
    id:'inpatient-hospitalist',
    sequence:1,
    label:'Inpatient hospitalist',
    careSetting:'inpatient',
    service:'Hospital Medicine',
    ownerActorId:'hosp-001',
    activeActorIds:['hosp-001','nurse-001'],
    ownerRole:'Hospitalist',
    reason:'Acute inpatient stabilization and discharge planning'
  },
  {
    id:'cardiology',
    sequence:2,
    label:'Cardiology transition',
    careSetting:'specialty-follow-up',
    service:'Cardiology',
    ownerActorId:'cardio-001',
    activeActorIds:['cardio-001','nurse-001'],
    ownerRole:'Cardiologist',
    reason:'Post-discharge heart-failure specialty follow-up'
  },
  {
    id:'outpatient-pcp',
    sequence:3,
    label:'Outpatient primary care',
    careSetting:'ambulatory',
    service:'Primary Care / Internal Medicine',
    ownerActorId:'clin-001',
    activeActorIds:['clin-001','care-001'],
    ownerRole:'Primary care physician',
    reason:'Longitudinal outpatient follow-up after specialty transition'
  }
];

function clone(v){return JSON.parse(JSON.stringify(v));}
function now(){return new Date().toISOString();}
function phaseById(id){return PHASES.find(x=>x.id===id)||null;}
function actorSummary(actorId){
  const actor=workforce[actorId];
  return actor?{id:actor.id,display:actor.display,role:actor.role,specialty:actor.specialty||actor.role}:{id:actorId,display:actorId,role:'unknown',specialty:'unknown'};
}
function initialState(phaseId=DEFAULT_PHASE_ID){
  const phase=phaseById(phaseId)||phaseById(DEFAULT_PHASE_ID);
  const at=now();
  return {
    patientId:DEMO_PATIENT_ID,
    currentPhaseId:phase.id,
    phaseStartedAt:at,
    history:[{type:'CARE_PHASE_ACTIVATED',at,toPhaseId:phase.id,toOwnerActorId:phase.ownerActorId,reason:'Synthetic baseline care ownership'}]
  };
}
function currentRaw(patientId=DEMO_PATIENT_ID){
  if(patientId!==DEMO_PATIENT_ID)return null;
  if(!stateByPatient.has(patientId))stateByPatient.set(patientId,initialState());
  return stateByPatient.get(patientId);
}
function careTeamFhir(state,phase){
  const patient=patients[state.patientId];
  const tenant=patient?.tenant||'helios-north';
  const pseudonym=patient?.pseudonym||state.patientId;
  const careTeam={
    resourceType:'CareTeam',
    id:`ct-${pseudonym}`.replace(/[^A-Za-z0-9.-]/g,'-').slice(0,64),
    meta:{source:'urn:helios:source:care-relationship-authority',tag:[{system:'https://helios.example/fhir/CodeSystem/demo-classification',code:'synthetic',display:'Synthetic demonstration data'}]},
    status:'active',
    category:[{text:'Transitions of care'}],
    name:`George Campbell — ${phase.label}`,
    subject:{reference:`Patient/${pseudonym}`},
    period:{start:state.phaseStartedAt},
    participant:phase.activeActorIds.map(actorId=>({
      role:[{text:actorId===phase.ownerActorId?phase.ownerRole:'Active care-team member'}],
      member:{reference:`Practitioner/${actorId}`,display:workforce[actorId]?.display||actorId},
      onBehalfOf:{reference:`Organization/${tenant}`},
      period:{start:state.phaseStartedAt}
    })),
    managingOrganization:[{reference:`Organization/${tenant}`,display:organizations[tenant]?.name||tenant}],
    reasonCode:[{text:phase.reason}],
    note:[{text:'Synthetic FHIR R4-shaped CareTeam projection for demonstration; not profile-validated production data.'}]
  };
  const provenance={
    resourceType:'Provenance',
    id:`prov-${careTeam.id}`,
    target:[{reference:`CareTeam/${careTeam.id}`}],
    occurredDateTime:state.history.at(-1)?.at||state.phaseStartedAt,
    recorded:now(),
    activity:{text:'Synthetic care-team ownership transition'},
    agent:[{type:{text:'Care relationship authority'},who:{identifier:{system:'https://helios.example/fhir/identifier/source-system',value:'CARE-RELATIONSHIP-AUTHORITY'}}}]
  };
  return {release:'R4',version:'4.0.1',representation:'FHIR R4-shaped synthetic CareTeam projection',profileValidation:'not-profile-validated',bundle:{resourceType:'Bundle',type:'collection',timestamp:now(),entry:[{resource:careTeam},{resource:provenance}]}};
}

export function careTeamHandoffSummary(patientId=DEMO_PATIENT_ID){
  const state=currentRaw(patientId);
  if(!state)return null;
  const phase=phaseById(state.currentPhaseId);
  return clone({
    patientId:state.patientId,
    patientDisplay:patients[state.patientId]?.name||state.patientId,
    currentPhaseId:phase.id,
    sequence:phase.sequence,
    label:phase.label,
    careSetting:phase.careSetting,
    service:phase.service,
    currentOwnerActorId:phase.ownerActorId,
    currentOwner:actorSummary(phase.ownerActorId),
    activeActorIds:[...phase.activeActorIds],
    activeMembers:phase.activeActorIds.map(actorSummary),
    ownerRole:phase.ownerRole,
    reason:phase.reason,
    phaseStartedAt:state.phaseStartedAt,
    phases:PHASES.map(p=>({id:p.id,sequence:p.sequence,label:p.label,careSetting:p.careSetting,service:p.service,ownerActorId:p.ownerActorId,owner:actorSummary(p.ownerActorId),activeActorIds:[...p.activeActorIds],ownerRole:p.ownerRole,reason:p.reason})),
    history:[...state.history],
    fhir:careTeamFhir(state,phase),
    demoMutable:true
  });
}

export function transitionCareTeamHandoff({patientId=DEMO_PATIENT_ID,action='next',phaseId}={}){
  if(patientId!==DEMO_PATIENT_ID)throw Object.assign(new Error('This synthetic handoff workflow is available for George Campbell only.'),{status:400,code:'DEMO_CARE_HANDOFF_NOT_MUTABLE'});
  if(action==='reset'){
    stateByPatient.set(patientId,initialState(DEFAULT_PHASE_ID));
    return careTeamHandoffSummary(patientId);
  }
  if(action==='restart'){
    stateByPatient.set(patientId,initialState('inpatient-hospitalist'));
    return careTeamHandoffSummary(patientId);
  }
  const current=currentRaw(patientId);
  const from=phaseById(current.currentPhaseId);
  let target=null;
  if(action==='next')target=PHASES.find(x=>x.sequence===from.sequence+1)||null;
  if(action==='set')target=phaseById(phaseId);
  if(!target)throw Object.assign(new Error(action==='next'?'No later care phase is available.':'Unknown care-team handoff phase.'),{status:400,code:'INVALID_CARE_HANDOFF_TRANSITION'});
  if(target.id===from.id)return careTeamHandoffSummary(patientId);
  const at=now();
  const next={
    patientId,
    currentPhaseId:target.id,
    phaseStartedAt:at,
    history:[...current.history,{type:'CARE_TEAM_HANDOFF',at,fromPhaseId:from.id,toPhaseId:target.id,fromOwnerActorId:from.ownerActorId,toOwnerActorId:target.ownerActorId}]
  };
  stateByPatient.set(patientId,next);
  return careTeamHandoffSummary(patientId);
}

export function careRelationshipDecision({actorId,patientId}){
  const baseIds=[...(careAssignments[actorId]||[])];
  if(patientId!==DEMO_PATIENT_ID){
    const allowed=isClinicianAssignedToPatient(actorId,patientId);
    return {
      allowed,
      code:allowed?null:'PATIENT_SCOPE_MISMATCH',
      message:allowed?null:`${workforce[actorId]?.display||actorId} is not assigned to this patient care context.`,
      source:'synthetic-care-team',
      assignedPatientIds:baseIds,
      context:allowed?{dynamic:false,active:true,patientId}:null
    };
  }
  const state=careTeamHandoffSummary(patientId);
  const active=state.activeActorIds.includes(actorId);
  const assignedPatientIds=active?[...new Set([...baseIds,patientId])]:baseIds.filter(id=>id!==patientId);
  return {
    allowed:active,
    code:active?null:'CARE_RELATIONSHIP_INACTIVE',
    message:active?null:`${workforce[actorId]?.display||actorId} is not part of George Campbell's active ${state.label} care team.`,
    source:'synthetic-dynamic-care-team',
    assignedPatientIds,
    context:{
      dynamic:true,
      active,
      patientId,
      phaseId:state.currentPhaseId,
      phaseLabel:state.label,
      careSetting:state.careSetting,
      service:state.service,
      currentOwnerActorId:state.currentOwnerActorId,
      activeActorIds:state.activeActorIds,
      phaseStartedAt:state.phaseStartedAt,
      relationshipVersion:state.history.length
    }
  };
}

export function effectiveAssignedPatientIds(actorId){
  const base=[...(careAssignments[actorId]||[])];
  const state=careTeamHandoffSummary(DEMO_PATIENT_ID);
  if(state.activeActorIds.includes(actorId))return [...new Set([...base,DEMO_PATIENT_ID])];
  return base.filter(id=>id!==DEMO_PATIENT_ID);
}

export function effectiveAssignedClinicianIds(patientId){
  if(patientId===DEMO_PATIENT_ID)return careTeamHandoffSummary(patientId).activeActorIds;
  return Object.entries(careAssignments).filter(([,ids])=>ids.includes(patientId)).map(([id])=>id);
}
