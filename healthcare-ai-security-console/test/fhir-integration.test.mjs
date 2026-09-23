import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClinicianContext, resolvePatientSupportContext } from '../server/services/context.mjs';
import { executeTool } from '../server/services/tools.mjs';

function resources(result){return (result.fhir?.bundle?.entry||[]).map(x=>x.resource)}

test('lab tool exposes FHIR R4 Observation + Provenance without raw patient id',()=>{
  const ctx=resolveClinicianContext({actorId:'neph-001',patientId:'pat-1001',encounterId:'enc-501',purpose:'lab-review'});
  const result=executeTool(ctx,'get_recent_labs');
  assert.equal(result.fhir.release,'R4');
  assert.equal(result.fhir.version,'4.0.1');
  assert.equal(result.fhir.bundle.resourceType,'Bundle');
  assert.equal(result.fhir.bundle.type,'collection');
  const rs=resources(result);
  const obs=rs.find(x=>x.resourceType==='Observation');
  const prov=rs.find(x=>x.resourceType==='Provenance');
  assert.ok(obs,'expected Observation');
  assert.ok(prov,'expected Provenance');
  assert.equal(obs.status,'final');
  assert.equal(obs.category[0].coding[0].code,'laboratory');
  assert.match(obs.subject.reference,/^Patient\/HN-P-/);
  assert.equal(typeof obs.valueQuantity.value,'number');
  assert.equal(prov.target[0].reference,`Observation/${obs.id}`);
  assert.doesNotMatch(JSON.stringify(result.fhir),/pat-1001/);
});

test('medication list uses MedicationStatement rather than pretending current meds are new orders',()=>{
  const ctx=resolveClinicianContext({actorId:'neph-001',patientId:'pat-1001',encounterId:'enc-501',purpose:'medication-review'});
  const result=executeTool(ctx,'get_medications');
  const types=resources(result).map(x=>x.resourceType);
  assert.ok(types.includes('MedicationStatement'));
  assert.ok(!types.includes('MedicationRequest'));
});

test('patient appointment exposes FHIR Appointment with pseudonymous Patient reference',()=>{
  const ctx=resolvePatientSupportContext({userId:'portal-1001',purpose:'patient-support'});
  const result=executeTool(ctx,'get_own_appointment');
  const appointment=resources(result).find(x=>x.resourceType==='Appointment');
  assert.ok(appointment);
  assert.equal(appointment.status,'booked');
  assert.match(appointment.participant[0].actor.reference,/^Patient\/HN-P-/);
  assert.doesNotMatch(JSON.stringify(result.fhir),/pat-1001/);
});

test('FHIR envelope is additive and preserves authoritative Helios evidence contract',()=>{
  const ctx=resolveClinicianContext({actorId:'neph-001',patientId:'pat-1001',encounterId:'enc-501',purpose:'lab-review'});
  const result=executeTool(ctx,'get_recent_labs');
  assert.equal(result.evidenceType,'AUTHORITATIVE PATIENT FACT');
  assert.equal(result.source,'LAB-SYSTEM');
  assert.ok(Array.isArray(result.labs));
  assert.ok(result.labs.length>0);
  assert.ok(result.fhir?.bundle);
});
