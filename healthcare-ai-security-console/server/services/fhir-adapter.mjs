const DEMO_CODE_SYSTEM='https://helios.example/fhir/CodeSystem/synthetic-clinical-code';
const DEMO_TAG_SYSTEM='https://helios.example/fhir/CodeSystem/demo-classification';
const SOURCE_IDENTIFIER_SYSTEM='https://helios.example/fhir/identifier/source-system';
const PSEUDONYM_IDENTIFIER_SYSTEM='https://helios.example/fhir/identifier/patient-pseudonym';

export const FHIR_RELEASE='R4';
export const FHIR_VERSION='4.0.1';

function fhirId(value='resource'){
  return String(value).replace(/[^A-Za-z0-9.-]/g,'-').slice(0,64)||'resource';
}
function sourceUri(source='HELIOS'){
  return `urn:helios:source:${String(source).toLowerCase().replace(/[^a-z0-9.-]/g,'-')}`;
}
function meta(source){
  return {
    source:sourceUri(source),
    tag:[{system:DEMO_TAG_SYSTEM,code:'synthetic',display:'Synthetic demonstration data'}]
  };
}
function patientFhirId(patient){return fhirId(patient.pseudonym||patient.id)}
function patientReference(patient){return {reference:`Patient/${patientFhirId(patient)}`}}
function concept(item){
  return {
    coding:item?.code?[{system:DEMO_CODE_SYSTEM,code:String(item.code),display:item.display||String(item.code)}]:undefined,
    text:item?.display||item?.text||item?.code||'Synthetic clinical concept'
  };
}
function compact(o){return Object.fromEntries(Object.entries(o).filter(([,v])=>v!==undefined&&v!==null))}
function interpretation(flag=''){
  const f=String(flag).toLowerCase();
  const map=f.includes('high')?['H','High']:f.includes('low')?['L','Low']:f.includes('normal')?['N','Normal']:null;
  if(map)return {coding:[{system:'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',code:map[0],display:map[1]}],text:map[1]};
  return flag?{text:String(flag)}:undefined;
}
function quantity(value,unit){
  const q={value,unit};
  const simpleUcum=new Set(['mmol/L','mg/dL','%','g/dL','ng/mL','pg/mL']);
  if(simpleUcum.has(unit)){q.system='http://unitsofmeasure.org';q.code=unit;}
  if(unit==='ratio'){q.system='http://unitsofmeasure.org';q.code='1';}
  return q;
}
function sourceTime(item){return item?.observedAt||item?.start||item?.date||undefined}
function provenance(resource,source,eventTime){
  return compact({
    resourceType:'Provenance',
    id:fhirId(`prov-${resource.resourceType}-${resource.id}`),
    target:[{reference:`${resource.resourceType}/${resource.id}`}],
    occurredDateTime:eventTime,
    recorded:new Date().toISOString(),
    activity:{text:'Synthetic source-system extraction for governed AI'},
    agent:[{
      type:{text:'Authoritative source system'},
      who:{identifier:{system:SOURCE_IDENTIFIER_SYSTEM,value:source||'HELIOS'}}
    }]
  });
}
function minimalPatient(patient,tenant){
  return {
    resourceType:'Patient',
    id:patientFhirId(patient),
    meta:meta('IDENTITY-CONTEXT'),
    identifier:[{system:PSEUDONYM_IDENTIFIER_SYSTEM,value:patient.pseudonym}],
    active:true,
    managingOrganization:tenant?{reference:`Organization/${fhirId(tenant)}`} : undefined
  };
}
function observation(lab,patient){
  return compact({
    resourceType:'Observation',
    id:fhirId(lab.id),
    meta:meta(lab.source||'LAB-SYSTEM'),
    status:'final',
    category:[{coding:[{system:'http://terminology.hl7.org/CodeSystem/observation-category',code:'laboratory',display:'Laboratory'}],text:'Laboratory'}],
    code:concept(lab),
    subject:patientReference(patient),
    effectiveDateTime:lab.observedAt,
    valueQuantity:quantity(lab.value,lab.unit),
    interpretation:interpretation(lab.flag)?[interpretation(lab.flag)]:undefined,
    note:[{text:'Synthetic demonstration observation; not medical data.'}]
  });
}
function encounterResource(encounter,patient){
  const cls=String(encounter.type||'').toLowerCase().includes('inpatient')?['IMP','inpatient encounter']:
    String(encounter.type||'').toLowerCase().includes('emerg')?['EMER','emergency']:['AMB','ambulatory'];
  const validStatuses=new Set(['planned','arrived','triaged','in-progress','onleave','finished','cancelled','entered-in-error','unknown']);
  const status=validStatuses.has(encounter.status)?encounter.status:'unknown';
  const participants=(encounter.participants||[]).map(p=>({
    period:{start:p.startedAt,end:p.endedAt||undefined},
    individual:{reference:`Practitioner/${fhirId(p.actorId)}`}
  }));
  return compact({
    resourceType:'Encounter',
    id:fhirId(encounter.id),
    meta:meta(encounter.source||'EHR-ENCOUNTERS'),
    status,
    class:{system:'http://terminology.hl7.org/CodeSystem/v3-ActCode',code:cls[0],display:cls[1]},
    subject:patientReference(patient),
    serviceType:encounter.service?{text:encounter.service}:undefined,
    period:{start:encounter.start,end:encounter.end||undefined},
    reasonCode:encounter.reason?[{text:encounter.reason}]:undefined,
    participant:participants.length?participants:(encounter.clinician?[{individual:{reference:`Practitioner/${fhirId(encounter.clinician)}`}}]:undefined)
  });
}
function medicationStatement(med,patient){
  const allowed=new Set(['active','completed','entered-in-error','intended','stopped','on-hold','unknown','not-taken']);
  const status=allowed.has(med.status)?med.status:'unknown';
  return compact({
    resourceType:'MedicationStatement',
    id:fhirId(med.id),
    meta:meta(med.source||'EHR-MEDICATIONS'),
    status,
    medicationCodeableConcept:concept(med),
    subject:patientReference(patient),
    dosage:med.dose?[{text:String(med.dose)}]:undefined
  });
}
function allergyIntolerance(allergy,patient){
  const criticality=['low','high','unable-to-assess'].includes(allergy.criticality)?allergy.criticality:undefined;
  return compact({
    resourceType:'AllergyIntolerance',
    id:fhirId(allergy.id),
    meta:meta(allergy.source||'EHR-ALLERGIES'),
    clinicalStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',code:'active',display:'Active'}]},
    type:'allergy',
    category:['medication'],
    criticality,
    code:concept(allergy),
    patient:patientReference(patient)
  });
}
function conditionResource(condition,patient){
  const original=String(condition.status||'active').toLowerCase();
  const status=['active','inactive','resolved'].includes(original)?original:'active';
  return compact({
    resourceType:'Condition',
    id:fhirId(condition.id),
    meta:meta(condition.source||'EHR-CONDITIONS'),
    clinicalStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/condition-clinical',code:status,display:status[0].toUpperCase()+status.slice(1)}]},
    code:concept(condition),
    subject:patientReference(patient),
    note:original!==status?[{text:`Source status: ${condition.status}`}]:undefined
  });
}
function appointmentResource(appointment,patient){
  const valid=new Set(['proposed','pending','booked','arrived','fulfilled','cancelled','noshow','entered-in-error','checked-in','waitlist']);
  const status=valid.has(appointment.status)?appointment.status:'booked';
  return compact({
    resourceType:'Appointment',
    id:fhirId(appointment.id),
    meta:meta('SCHEDULING'),
    status,
    serviceType:appointment.clinic?[{text:appointment.clinic}]:undefined,
    start:appointment.date,
    participant:[{actor:patientReference(patient),status:'accepted'}]
  });
}
function appendResource(resources,resource,source,eventTime){
  if(!resource)return;
  resources.push(resource);
  if(resource.resourceType!=='Patient')resources.push(provenance(resource,source,eventTime));
}
function bundle(resources){
  return {resourceType:'Bundle',type:'collection',timestamp:new Date().toISOString(),entry:resources.map(resource=>({resource}))};
}

export function buildFhirEnvelope({context,name,patient,result}){
  const supported=new Set(['get_patient_summary','get_encounter','get_recent_labs','get_medications','get_allergies','get_conditions','get_own_appointment']);
  if(!supported.has(name))return null;
  const resources=[minimalPatient(patient,context.tenant)];
  if(name==='get_patient_summary'){
    for(const e of result.encounters||[])appendResource(resources,encounterResource(e,patient),e.source||'EHR-ENCOUNTERS',sourceTime(e));
    for(const l of result.labs||[])appendResource(resources,observation(l,patient),l.source||'LAB-SYSTEM',sourceTime(l));
    for(const m of result.medications||[])appendResource(resources,medicationStatement(m,patient),m.source||'EHR-MEDICATIONS',sourceTime(m));
    for(const a of result.allergies||[])appendResource(resources,allergyIntolerance(a,patient),a.source||'EHR-ALLERGIES',sourceTime(a));
    for(const c of result.conditions||[])appendResource(resources,conditionResource(c,patient),c.source||'EHR-CONDITIONS',sourceTime(c));
  }
  if(name==='get_encounter'&&result.encounter)appendResource(resources,encounterResource(result.encounter,patient),result.encounter.source||'EHR-ENCOUNTERS',sourceTime(result.encounter));
  if(name==='get_recent_labs')for(const l of result.labs||[])appendResource(resources,observation(l,patient),l.source||'LAB-SYSTEM',sourceTime(l));
  if(name==='get_medications')for(const m of result.medications||[])appendResource(resources,medicationStatement(m,patient),m.source||'EHR-MEDICATIONS',sourceTime(m));
  if(name==='get_allergies')for(const a of result.allergies||[])appendResource(resources,allergyIntolerance(a,patient),a.source||'EHR-ALLERGIES',sourceTime(a));
  if(name==='get_conditions')for(const c of result.conditions||[])appendResource(resources,conditionResource(c,patient),c.source||'EHR-CONDITIONS',sourceTime(c));
  if(name==='get_own_appointment')for(const a of result.appointments||[])appendResource(resources,appointmentResource(a,patient),'SCHEDULING',sourceTime(a));
  return {
    release:FHIR_RELEASE,
    version:FHIR_VERSION,
    representation:'FHIR R4-shaped synthetic resources',
    profileValidation:'not-profile-validated',
    bundle:bundle(resources)
  };
}
