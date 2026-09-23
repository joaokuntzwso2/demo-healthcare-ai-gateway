import { encountersById, workforce, careAssignments } from '../data/synthetic-healthcare.mjs';

const ACTIVE_FHIR_STATUSES=new Set(['planned','arrived','triaged','in-progress','onleave']);
const DEMO_MUTABLE_ENCOUNTERS=new Set(['enc-501']);
const overrides=new Map();

function clone(value){return JSON.parse(JSON.stringify(value));}
function participant(actorId,role,startedAt,endedAt=null){return {actorId,role,startedAt,endedAt};}
function baseLifecycle(encounterId){
  const encounter=encountersById[encounterId];
  if(!encounter)return null;
  if(encounterId==='enc-501'){
    return {
      encounterId,
      patientId:encounter.patient,
      tenant:encounter.tenant,
      status:'in-progress',
      lifecycleState:'active-care',
      service:'Nephrology',
      currentOwnerActorId:'neph-001',
      period:{start:encounter.start,end:null},
      participants:[
        participant('neph-001','attending-nephrologist',encounter.start),
        participant('clin-001','attending-internal-medicine',encounter.start),
        participant('nurse-001','ambulatory-care-nurse',encounter.start)
      ],
      dischargeDisposition:null,
      lastTransition:{type:'INITIAL_ACTIVE_CONTEXT',at:encounter.start},
      demoMutable:true
    };
  }
  return {
    encounterId,
    patientId:encounter.patient,
    tenant:encounter.tenant,
    status:encounter.status||'in-progress',
    lifecycleState:'active-care',
    service:encounter.service||workforce[encounter.clinician]?.specialty||encounter.type||'Clinical Service',
    currentOwnerActorId:encounter.clinician||null,
    period:{start:encounter.start,end:encounter.end||null},
    participants:encounter.clinician?[participant(encounter.clinician,'primary-clinician',encounter.start)]:[],
    dischargeDisposition:null,
    lastTransition:{type:'STATIC_SYNTHETIC_CONTEXT',at:encounter.start},
    demoMutable:false
  };
}

export function getEncounterLifecycle(encounterId){
  const base=baseLifecycle(encounterId);
  if(!base)return null;
  return clone(overrides.get(encounterId)||base);
}

export function encounterWithLifecycle(encounterOrId){
  const encounter=typeof encounterOrId==='string'?encountersById[encounterOrId]:encounterOrId;
  if(!encounter)return null;
  const lifecycle=getEncounterLifecycle(encounter.id);
  if(!lifecycle)return {...encounter};
  return {
    ...encounter,
    status:lifecycle.status,
    service:lifecycle.service,
    end:lifecycle.period?.end||null,
    lifecycleState:lifecycle.lifecycleState,
    currentOwnerActorId:lifecycle.currentOwnerActorId,
    participants:lifecycle.participants,
    dischargeDisposition:lifecycle.dischargeDisposition||null
  };
}

export function encounterAccessDecision({actorId,encounterId}){
  const lifecycle=getEncounterLifecycle(encounterId);
  if(!lifecycle){
    return {allowed:false,code:'PATIENT_SCOPE_MISMATCH',message:'Encounter does not exist in the authorized clinical context.',context:null};
  }
  const p=lifecycle.participants.find(x=>x.actorId===actorId&&!x.endedAt)||lifecycle.participants.find(x=>x.actorId===actorId);
  const activeStatus=ACTIVE_FHIR_STATUSES.has(lifecycle.status);
  const participantActive=Boolean(p&&!p.endedAt);
  const context={
    encounterId:lifecycle.encounterId,
    status:lifecycle.status,
    lifecycleState:lifecycle.lifecycleState,
    service:lifecycle.service,
    currentOwnerActorId:lifecycle.currentOwnerActorId,
    participantActive,
    period:lifecycle.period,
    lastTransition:lifecycle.lastTransition
  };
  if(!activeStatus){
    return {allowed:false,code:'ENCOUNTER_ACCESS_EXPIRED',message:`Encounter ${encounterId} is ${lifecycle.status}; encounter-scoped AI access is no longer active.`,context};
  }
  if(!participantActive){
    const previouslyParticipated=Boolean(p);
    return {
      allowed:false,
      code:previouslyParticipated?'ENCOUNTER_ACCESS_EXPIRED':'ENCOUNTER_NOT_ASSIGNED',
      message:previouslyParticipated
        ? `${actorId} is no longer an active participant in encounter ${encounterId}.`
        : `${actorId} is not an active participant in encounter ${encounterId}.`,
      context
    };
  }
  return {allowed:true,code:null,message:null,context};
}

function validateTransferTarget(lifecycle,targetActorId){
  const actor=workforce[targetActorId];
  if(!actor)throw Object.assign(new Error(`Unknown transfer target ${targetActorId}.`),{status:400,code:'INVALID_TRANSFER_TARGET'});
  if(actor.tenant!==lifecycle.tenant)throw Object.assign(new Error('Transfer target must belong to the same tenant.'),{status:400,code:'INVALID_TRANSFER_TARGET'});
  if(!(careAssignments[targetActorId]||[]).includes(lifecycle.patientId)){
    throw Object.assign(new Error('Transfer target must already have a valid patient-level care relationship in this synthetic demo.'),{status:400,code:'INVALID_TRANSFER_TARGET'});
  }
  return actor;
}

export function transitionEncounterLifecycle({encounterId='enc-501',action='reset',transferredToActorId='clin-001'}={}){
  if(!DEMO_MUTABLE_ENCOUNTERS.has(encounterId)){
    throw Object.assign(new Error(`Encounter ${encounterId} is not mutable in the lifecycle demonstration.`),{status:400,code:'DEMO_ENCOUNTER_NOT_MUTABLE'});
  }
  if(action==='reset'){
    overrides.delete(encounterId);
    return getEncounterLifecycle(encounterId);
  }
  const current=getEncounterLifecycle(encounterId);
  const now=new Date().toISOString();
  if(action==='transfer'){
    const target=validateTransferTarget(current,transferredToActorId);
    const participants=current.participants.map(p=>p.endedAt?p:{...p,endedAt:now});
    participants.push(participant(target.id,`receiving-${String(target.role||'clinician')}`,now));
    const next={
      ...current,
      status:'in-progress',
      lifecycleState:'transferred-care',
      service:target.specialty||target.role,
      currentOwnerActorId:target.id,
      participants,
      dischargeDisposition:null,
      lastTransition:{type:'TRANSFER',at:now,fromActorId:current.currentOwnerActorId,toActorId:target.id}
    };
    overrides.set(encounterId,next);
    return clone(next);
  }
  if(action==='discharge'){
    const next={
      ...current,
      status:'finished',
      lifecycleState:'discharged',
      currentOwnerActorId:null,
      period:{...current.period,end:now},
      participants:current.participants.map(p=>p.endedAt?p:{...p,endedAt:now}),
      dischargeDisposition:'home',
      lastTransition:{type:'DISCHARGE',at:now,fromActorId:current.currentOwnerActorId}
    };
    overrides.set(encounterId,next);
    return clone(next);
  }
  throw Object.assign(new Error(`Unsupported lifecycle action ${action}. Use reset, transfer, or discharge.`),{status:400,code:'INVALID_ENCOUNTER_TRANSITION'});
}

export function encounterLifecycleSummary(encounterId){return getEncounterLifecycle(encounterId);}
