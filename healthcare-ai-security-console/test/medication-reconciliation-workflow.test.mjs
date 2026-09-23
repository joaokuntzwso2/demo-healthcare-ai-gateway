import test from 'node:test';
import assert from 'node:assert/strict';

import {
  medicationReconciliationEvidence,
  createMedicationReconciliationForTest,
  submitMedicationReconciliation,
  medicationReconciliationSummary,
  medicationReconciliationAudit,
  resetMedicationReconciliation
} from '../server/services/medication-reconciliation-workflow.mjs';
import { demoCatalog } from '../server/services/demo-catalog.mjs';

const actorId='neph-001';
const patientId='pat-1001';

test.beforeEach(()=>resetMedicationReconciliation({actorId,patientId}));

test('post-discharge reconciliation exposes three distinct source classes',()=>{
  const state=medicationReconciliationEvidence(patientId);

  assert.equal(state.postDischarge,true);
  assert.equal(state.evidenceType,'MULTI_SOURCE_MEDICATION_RECONCILIATION');
  assert.deepEqual(
    state.evidence.sourceOrder,
    ['EHR_MEDICATION_LIST','PATIENT_REPORTED_MEDICATIONS','DISCHARGE_INSTRUCTIONS']
  );

  for(const line of state.evidence.lines){
    assert.equal(line.claims.length,3);
    assert.equal(line.authoritativeWinner,null);
  }
});

test('lisinopril and furosemide are deterministically unresolved',()=>{
  const state=medicationReconciliationEvidence(patientId);

  const lisinopril=state.evidence.lines.find(x=>x.medicationKey==='lisinopril');
  const furosemide=state.evidence.lines.find(x=>x.medicationKey==='furosemide');

  assert.equal(lisinopril.reconciliationState,'UNRESOLVED');
  assert.ok(lisinopril.differingFields.includes('dose'));
  assert.ok(lisinopril.differingFields.includes('frequency'));

  assert.equal(furosemide.reconciliationState,'UNRESOLVED');
  assert.ok(furosemide.differingFields.includes('status'));
  assert.ok(furosemide.differingFields.includes('dose'));
});

test('AI draft is explicitly non-authoritative and cannot select a winner',()=>{
  const session=createMedicationReconciliationForTest({actorId,patientId});

  assert.equal(session.status,'PENDING_HUMAN_RECONCILIATION');
  assert.equal(session.aiReview.authority,false);
  assert.equal(session.aiReview.maySelectWinner,false);
  assert.equal(session.humanReview.status,'PENDING');

  for(const line of session.evidence.lines){
    assert.equal(line.authoritativeWinner,null);
  }
});

test('evidence snapshot is cryptographically bound to AI and human review',()=>{
  const session=createMedicationReconciliationForTest({actorId,patientId});

  assert.match(session.evidence.snapshotHash,/^[a-f0-9]{64}$/);
  assert.equal(session.aiReview.evidenceSnapshotHash,session.evidence.snapshotHash);
  assert.equal(session.humanReview.evidenceSnapshotHash,session.evidence.snapshotHash);
});

test('human can reconcile each medication to an explicit source',()=>{
  const session=createMedicationReconciliationForTest({actorId,patientId});

  const result=submitMedicationReconciliation({
    sessionId:session.sessionId,
    reviewerActorId:actorId,
    decisions:[
      {medicationKey:'lisinopril',resolution:'USE_DISCHARGE'},
      {medicationKey:'furosemide',resolution:'USE_EHR'}
    ],
    comment:'Synthetic reconciliation test.'
  });

  assert.equal(result.status,'RECONCILED_HUMAN_REVIEWED');
  assert.equal(result.humanReview.status,'RECONCILED');
  assert.equal(result.humanReview.reviewerActorId,actorId);
  assert.equal(result.humanReview.decisions.length,2);

  const lisinopril=result.humanReview.decisions.find(x=>x.medicationKey==='lisinopril');
  assert.equal(lisinopril.authoritativeBy,'HUMAN_REVIEW');
  assert.equal(lisinopril.selectedSourceId,'DISCHARGE_INSTRUCTIONS');
  assert.equal(lisinopril.reconciledClaim.dose.value,20);

  const furosemide=result.humanReview.decisions.find(x=>x.medicationKey==='furosemide');
  assert.equal(furosemide.selectedSourceId,'EHR_MEDICATION_LIST');
  assert.equal(furosemide.reconciledClaim.dose.value,20);
});

test('human can defer a medication instead of manufacturing certainty',()=>{
  const session=createMedicationReconciliationForTest({actorId,patientId});

  const result=submitMedicationReconciliation({
    sessionId:session.sessionId,
    reviewerActorId:actorId,
    decisions:[
      {medicationKey:'lisinopril',resolution:'USE_DISCHARGE'},
      {medicationKey:'furosemide',resolution:'DEFER_CLARIFICATION'}
    ]
  });

  assert.equal(result.status,'PARTIALLY_RECONCILED_HUMAN_REVIEWED');
  assert.equal(result.outcome.resolvedCount,1);
  assert.equal(result.outcome.deferredCount,1);

  const deferred=result.humanReview.decisions.find(x=>x.medicationKey==='furosemide');
  assert.equal(deferred.state,'DEFERRED');
  assert.equal(deferred.selectedSourceId,null);
  assert.equal(deferred.reconciledClaim,null);
});

test('human reconciliation never writes the EHR or changes a prescription in the demo',()=>{
  const session=createMedicationReconciliationForTest({actorId,patientId});

  const result=submitMedicationReconciliation({
    sessionId:session.sessionId,
    reviewerActorId:actorId,
    decisions:[
      {medicationKey:'lisinopril',resolution:'USE_EHR'},
      {medicationKey:'furosemide',resolution:'USE_DISCHARGE'}
    ]
  });

  assert.equal(result.outcome.ehrWritebackSupported,false);
  assert.equal(result.outcome.ehrWritten,false);
  assert.equal(result.outcome.prescriptionChanged,false);
  assert.equal(result.outcome.orderCreated,false);
});

test('completed reconciliation is terminal until reset',()=>{
  const session=createMedicationReconciliationForTest({actorId,patientId});

  submitMedicationReconciliation({
    sessionId:session.sessionId,
    reviewerActorId:actorId,
    decisions:[
      {medicationKey:'lisinopril',resolution:'USE_EHR'},
      {medicationKey:'furosemide',resolution:'USE_EHR'}
    ]
  });

  assert.throws(
    ()=>submitMedicationReconciliation({
      sessionId:session.sessionId,
      reviewerActorId:actorId,
      decisions:[
        {medicationKey:'lisinopril',resolution:'USE_DISCHARGE'},
        {medicationKey:'furosemide',resolution:'USE_DISCHARGE'}
      ]
    }),
    e=>e.code==='MEDICATION_RECONCILIATION_ALREADY_COMPLETED'
  );
});

test('audit distinguishes system, AI assistance, human reconciliation and non-execution',()=>{
  const session=createMedicationReconciliationForTest({actorId,patientId});

  submitMedicationReconciliation({
    sessionId:session.sessionId,
    reviewerActorId:actorId,
    decisions:[
      {medicationKey:'lisinopril',resolution:'USE_DISCHARGE'},
      {medicationKey:'furosemide',resolution:'DEFER_CLARIFICATION'}
    ]
  });

  const events=medicationReconciliationAudit({patientId,sessionId:session.sessionId});

  assert.ok(events.find(x=>x.type==='MED_REC_SOURCE_SNAPSHOT_ASSEMBLED'&&x.authority==='SYSTEM'));
  assert.ok(events.find(x=>x.type==='AI_RECONCILIATION_DRAFT_CREATED'&&x.authority==='AI_ASSISTED'));
  assert.ok(events.find(x=>x.type==='HUMAN_RECONCILIATION_REQUIRED'&&x.authority==='SYSTEM'));
  assert.ok(events.find(x=>x.type==='HUMAN_MED_REC_PARTIALLY_RECONCILED'&&x.authority==='HUMAN'));

  const nonExecution=events.find(x=>x.type==='MED_REC_NON_EXECUTION_CONFIRMED');
  assert.ok(nonExecution);
  assert.equal(nonExecution.authority,'SYSTEM');
  assert.equal(nonExecution.chartWritten,false);
  assert.equal(nonExecution.orderCreated,false);
});

test('summary policy keeps final medication authority outside the model',()=>{
  createMedicationReconciliationForTest({actorId,patientId});
  const state=medicationReconciliationSummary({actorId,patientId});

  assert.equal(state.policy.aiMayCompareSources,true);
  assert.equal(state.policy.aiMayDraftReconciliationReview,true);
  assert.equal(state.policy.aiMaySelectAuthoritativeWinner,false);
  assert.equal(state.policy.recencyAloneMaySelectWinner,false);
  assert.equal(state.policy.humanResolutionRequired,true);
  assert.equal(state.policy.ehrWritebackSupported,false);
  assert.equal(state.policy.prescriptionExecutionSupported,false);
});

test('executive catalog exposes medication reconciliation workflow',()=>{
  const story=demoCatalog().executiveStories.find(x=>x.id==='medication-reconciliation-workflow');

  assert.ok(story);
  assert.equal(story.patientId,'pat-1001');
  assert.equal(story.actorId,'neph-001');
  assert.equal(story.purpose,'medication-review');
});
