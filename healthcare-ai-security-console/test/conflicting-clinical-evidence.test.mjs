import test from 'node:test';
import assert from 'node:assert/strict';

import {
  medicationEvidenceForPatient,
  clinicalEvidenceConflictSummary,
  deterministicConflictNarrative
} from '../server/services/clinical-evidence-conflict.mjs';
import { resolveClinicianContext } from '../server/services/context.mjs';
import { executeTool } from '../server/services/tools.mjs';
import { requiredEvidenceTool, conflictAwareNarrative } from '../server/services/copilot.mjs';
import { demoCatalog } from '../server/services/demo-catalog.mjs';

test('Marcus has an unresolved lisinopril dose conflict with two authoritative sources',()=>{
  const evidence=medicationEvidenceForPatient('pat-1001');
  assert.equal(evidence.status,'CONFLICT');
  assert.equal(evidence.conflicts.length,1);

  const conflict=evidence.conflicts[0];
  assert.equal(conflict.type,'MEDICATION_DOSE_CONFLICT');
  assert.equal(conflict.reconciliation.state,'UNRESOLVED');
  assert.equal(conflict.reconciliation.authoritativeWinner,null);

  const home=conflict.claims.find(x=>x.sourceId==='HOME-MEDICATION-LIST');
  const discharge=conflict.claims.find(x=>x.sourceId==='DISCHARGE-MEDICATION-RECONCILIATION');

  assert.equal(home.dose.value,10);
  assert.equal(home.dose.unit,'mg');
  assert.equal(discharge.dose.value,20);
  assert.equal(discharge.dose.unit,'mg');
});

test('get_medications returns conflict and provenance without choosing a winner',()=>{
  const context=resolveClinicianContext({
    actorId:'neph-001',
    patientId:'pat-1001',
    encounterId:null,
    purpose:'medication-review'
  });
  const result=executeTool(context,'get_medications');

  assert.equal(result.medicationEvidence.status,'CONFLICT');
  assert.equal(result.conflicts[0].reconciliation.authoritativeWinner,null);
  assert.deepEqual(
    result.medicationEvidence.claims.map(x=>x.sourceId).sort(),
    ['DISCHARGE-MEDICATION-RECONCILIATION','HOME-MEDICATION-LIST']
  );
});

test('medication reconciliation prompt is forced to authoritative medication tool',()=>{
  assert.equal(
    requiredEvidenceTool(
      'What is Marcus Reed’s current lisinopril dose? Compare the home medication list with discharge medication reconciliation.',
      'clinician'
    ),
    'get_medications'
  );
});

test('unsafe single-dose model answer is replaced by deterministic conflict narrative',()=>{
  const context=resolveClinicianContext({
    actorId:'neph-001',
    patientId:'pat-1001',
    encounterId:null,
    purpose:'medication-review'
  });
  const result=executeTool(context,'get_medications');

  const projection=conflictAwareNarrative({
    answer:'The current lisinopril dose is 20 mg daily.',
    evidence:[result]
  });

  assert.deepEqual(projection.advisories,['CLINICAL_EVIDENCE_CONFLICT']);
  assert.match(projection.answer,/Home Medication List reports Lisinopril 10 mg/i);
  assert.match(projection.answer,/Discharge Medication Reconciliation reports Lisinopril 20 mg/i);
  assert.match(projection.answer,/does not select either dose as the current truth/i);
  assert.match(projection.answer,/Clinician medication reconciliation is required/i);
});

test('conflict API projection contains patient pseudonym and source provenance',()=>{
  const state=clinicalEvidenceConflictSummary('pat-1001');
  assert.equal(state.medicationEvidence.status,'CONFLICT');
  assert.ok(state.patient.pseudonym);
  assert.equal(state.policy.silentResolutionAllowed,false);
  assert.equal(state.policy.sourceProvenanceRequired,true);
});

test('deterministic narrative names both sources and both values',()=>{
  const conflict=medicationEvidenceForPatient('pat-1001').conflicts[0];
  const answer=deterministicConflictNarrative(conflict);
  assert.match(answer,/10 mg/);
  assert.match(answer,/20 mg/);
  assert.match(answer,/Home Medication List/);
  assert.match(answer,/Discharge Medication Reconciliation/);
});

test('executive catalog exposes conflicting clinical evidence story',()=>{
  const story=demoCatalog().executiveStories.find(x=>x.id==='conflicting-clinical-evidence');
  assert.ok(story);
  assert.equal(story.patientId,'pat-1001');
  assert.equal(story.actorId,'neph-001');
  assert.equal(story.purpose,'medication-review');
});
