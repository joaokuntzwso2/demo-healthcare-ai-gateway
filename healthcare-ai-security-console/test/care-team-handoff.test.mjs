import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClinicianContext } from '../server/services/context.mjs';
import { careTeamHandoffSummary, transitionCareTeamHandoff } from '../server/services/care-team-handoff.mjs';
import { demoCatalog } from '../server/services/demo-catalog.mjs';

test('care-team ownership follows hospitalist to cardiology to outpatient PCP',()=>{
  transitionCareTeamHandoff({patientId:'pat-1003',action:'restart'});
  try{
    let state=careTeamHandoffSummary('pat-1003');
    assert.equal(state.currentPhaseId,'inpatient-hospitalist');
    assert.equal(state.currentOwnerActorId,'hosp-001');
    assert.equal(resolveClinicianContext({actorId:'hosp-001',patientId:'pat-1003',encounterId:null,purpose:'encounter-summary'}).careRelationship.phaseId,'inpatient-hospitalist');
    assert.throws(
      ()=>resolveClinicianContext({actorId:'cardio-001',patientId:'pat-1003',encounterId:null,purpose:'encounter-summary'}),
      e=>e.code==='CARE_RELATIONSHIP_INACTIVE'
    );

    state=transitionCareTeamHandoff({patientId:'pat-1003',action:'next'});
    assert.equal(state.currentPhaseId,'cardiology');
    assert.equal(state.currentOwnerActorId,'cardio-001');
    assert.throws(
      ()=>resolveClinicianContext({actorId:'hosp-001',patientId:'pat-1003',encounterId:null,purpose:'encounter-summary'}),
      e=>e.code==='CARE_RELATIONSHIP_INACTIVE'
    );
    assert.equal(resolveClinicianContext({actorId:'cardio-001',patientId:'pat-1003',encounterId:null,purpose:'encounter-summary'}).careRelationship.phaseId,'cardiology');

    state=transitionCareTeamHandoff({patientId:'pat-1003',action:'next'});
    assert.equal(state.currentPhaseId,'outpatient-pcp');
    assert.equal(state.currentOwnerActorId,'clin-001');
    assert.throws(
      ()=>resolveClinicianContext({actorId:'cardio-001',patientId:'pat-1003',encounterId:null,purpose:'encounter-summary'}),
      e=>e.code==='CARE_RELATIONSHIP_INACTIVE'
    );
    const pcp=resolveClinicianContext({actorId:'clin-001',patientId:'pat-1003',encounterId:null,purpose:'encounter-summary'});
    assert.equal(pcp.careRelationship.phaseId,'outpatient-pcp');
    assert.equal(pcp.careRelationship.currentOwnerActorId,'clin-001');
  } finally {
    transitionCareTeamHandoff({patientId:'pat-1003',action:'reset'});
  }
});

test('non-handoff patient assignments continue using the existing relationship model',()=>{
  const ctx=resolveClinicianContext({actorId:'neph-001',patientId:'pat-1001',encounterId:null,purpose:'lab-review'});
  assert.equal(ctx.patient.id,'pat-1001');
  assert.equal(ctx.patientAssignment.assigned,true);
});

test('handoff exposes FHIR R4-shaped CareTeam and Provenance without internal patient id',()=>{
  transitionCareTeamHandoff({patientId:'pat-1003',action:'restart'});
  try{
    const state=careTeamHandoffSummary('pat-1003');
    assert.equal(state.fhir.release,'R4');
    const resources=state.fhir.bundle.entry.map(x=>x.resource);
    assert.ok(resources.some(x=>x.resourceType==='CareTeam'));
    assert.ok(resources.some(x=>x.resourceType==='Provenance'));
    assert.equal(JSON.stringify(state.fhir).includes('pat-1003'),false);
  } finally {
    transitionCareTeamHandoff({patientId:'pat-1003',action:'reset'});
  }
});

test('executive catalog includes care-team handoff story',()=>{
  const story=demoCatalog().executiveStories.find(x=>x.id==='care-team-handoff');
  assert.ok(story);
  assert.equal(story.patientId,'pat-1003');
  assert.equal(story.actorId,'hosp-001');
  assert.equal(story.encounterId,null);
  assert.equal(story.handoffPhase,'inpatient-hospitalist');
});
