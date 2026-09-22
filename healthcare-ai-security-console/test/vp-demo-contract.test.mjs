import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {organizations,workforce,patients,patientSupportUsers} from '../server/data/synthetic-healthcare.mjs';
import {demoCatalog} from '../server/services/demo-catalog.mjs';

const root=resolve(import.meta.dirname,'../..');

test('VP demo has a credible multi-persona synthetic healthcare domain',()=>{
  assert.ok(Object.keys(organizations).length>=3);
  assert.ok(Object.keys(workforce).length>=10);
  assert.ok(Object.keys(patients).length>=8);
  assert.ok(Object.keys(patientSupportUsers).length>=8);
  assert.ok(Object.values(patients).some(p=>p.labs.length>=5),'at least one longitudinal lab story is required');
});

test('policy catalog covers the exact 24-stage clinician Gateway chain',async()=>{
  const chain=JSON.parse(await readFile(resolve(root,'modular-ai-guardrails/config/clinical-policy-chain.json'),'utf8'));
  const ids=demoCatalog().policyScenarios.map(x=>x.id);
  assert.equal(ids.length,24);
  assert.deepEqual(ids,chain.map(x=>x.name));
  for(const p of demoCatalog().policyScenarios){
    assert.ok(p.scenario?.length>30,`${p.id} needs a realistic scenario`);
    assert.ok(p.example?.length>10,`${p.id} needs an example`);
    assert.ok(p.business?.length>20,`${p.id} needs executive value`);
  }
});

test('executive stories exercise multiple specialties and patient journeys',()=>{
  const c=demoCatalog();
  assert.ok(c.executiveStories.length>=6);
  assert.ok(new Set(c.executiveStories.map(x=>x.patientId).filter(Boolean)).size>=4);
  assert.ok(c.patientCases.some(x=>x.serviceLine==='Cardiology'));
  assert.ok(c.patientCases.some(x=>x.serviceLine==='Endocrinology'));
  assert.ok(c.patientCases.some(x=>x.serviceLine==='Nephrology'));
});


test('executive catalog exposes an intentional patient-assignment denial story',()=>{
  const c=demoCatalog();
  const story=c.executiveStories.find(x=>x.id==='patient-assignment-boundary');
  assert.ok(story);
  assert.equal(story.actorId,'neph-001');
  assert.equal(story.patientId,'pat-1004');
  const priya=c.clinicians.find(x=>x.id==='neph-001');
  const mateo=c.clinicians.find(x=>x.id==='endo-001');
  assert.equal(priya.assignedPatientIds.includes('pat-1004'),false);
  assert.equal(mateo.assignedPatientIds.includes('pat-1004'),true);
});
