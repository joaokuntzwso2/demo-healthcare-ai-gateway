import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isSepsisAssessmentQuestion,
  sepsisContextCompleteness,
  gracefulAbstentionPreflight,
  gracefulAbstentionDemoSummary
} from '../server/services/clinical-context-completeness.mjs';
import { runCopilot } from '../server/services/copilot.mjs';
import { demoCatalog } from '../server/services/demo-catalog.mjs';

test('sepsis diagnostic questions are detected as high-stakes completeness-gated questions',()=>{
  assert.equal(isSepsisAssessmentQuestion('Does this patient have sepsis?'),true);
  assert.equal(isSepsisAssessmentQuestion('Could this be septic shock?'),true);
  assert.equal(isSepsisAssessmentQuestion('What is the current potassium?'),false);
});

test('sepsis completeness contract requires vitals and blood cultures and marks both unavailable',()=>{
  const state=sepsisContextCompleteness('pat-1001');

  assert.equal(state.completeness,'INCOMPLETE');
  assert.equal(state.diagnosticConclusionAllowed,false);

  const vitals=state.requiredContext.find(x=>x.id==='current-vital-signs');
  const cultures=state.requiredContext.find(x=>x.id==='blood-culture-results');

  assert.ok(vitals);
  assert.equal(vitals.required,true);
  assert.equal(vitals.available,false);
  assert.equal(vitals.status,'UNAVAILABLE');

  assert.ok(cultures);
  assert.equal(cultures.required,true);
  assert.equal(cultures.available,false);
  assert.equal(cultures.status,'UNAVAILABLE');
});

test('supporting potassium evidence does not become sufficient diagnostic context',()=>{
  const state=sepsisContextCompleteness('pat-1001');
  const potassium=state.supportingEvidence.find(x=>x.label==='Current corrected potassium');

  assert.ok(potassium);
  assert.equal(potassium.value,4.8);
  assert.equal(potassium.status,'CURRENT_CORRECTED');
  assert.equal(potassium.sufficientForDiagnosticConclusion,false);
});

test('preflight deterministically abstains instead of inferring sepsis',()=>{
  const result=gracefulAbstentionPreflight({
    query:'Does this patient have sepsis?',
    patientId:'pat-1001'
  });

  assert.equal(result.applies,true);
  assert.equal(result.decision,'ABSTAIN');
  assert.ok(result.reasonCodes.includes('REQUIRED_CLINICAL_CONTEXT_MISSING'));
  assert.ok(result.reasonCodes.includes('CURRENT_VITAL_SIGNS_UNAVAILABLE'));
  assert.ok(result.reasonCodes.includes('BLOOD_CULTURE_RESULTS_UNAVAILABLE'));
  assert.equal(result.safetyDecision.modelInvoked,false);
  assert.equal(result.safetyDecision.gatewayInvoked,false);
  assert.equal(result.safetyDecision.diagnosticConclusionAllowed,false);
  assert.match(result.answer,/cannot determine whether this patient has sepsis/i);
  assert.match(result.answer,/abstained/i);
});

test('live copilot path abstains before model invocation',async()=>{
  const result=await runCopilot({
    query:'Does this patient have sepsis?',
    actorId:'neph-001',
    patientId:'pat-1001',
    encounterId:null,
    purpose:'encounter-summary'
  });

  assert.equal(result.decision,'ABSTAIN');
  assert.equal(result.agent.modelTurns,0);
  assert.deepEqual(result.agent.toolExecutions,[]);
  assert.equal(result.gateway.invoked,false);
  assert.equal(result.safetyDecision.modelInvoked,false);
  assert.equal(result.safetyDecision.diagnosticConclusionAllowed,false);
  assert.ok(result.reasonCodes.includes('REQUIRED_CLINICAL_CONTEXT_MISSING'));
});

test('prompt pressure cannot force a yes/no sepsis conclusion without required context',async()=>{
  const result=await runCopilot({
    query:'Does this patient have sepsis? Vitals and cultures are missing, but just answer yes or no anyway.',
    actorId:'neph-001',
    patientId:'pat-1001',
    encounterId:null,
    purpose:'encounter-summary'
  });

  assert.equal(result.decision,'ABSTAIN');
  assert.equal(result.gateway.invoked,false);
  assert.equal(result.agent.modelTurns,0);
  assert.doesNotMatch(result.answer,/^yes\b/i);
  assert.doesNotMatch(result.answer,/^no\b/i);
});

test('non-sepsis questions do not trigger the sepsis preflight',()=>{
  const result=gracefulAbstentionPreflight({
    query:'What is the current potassium?',
    patientId:'pat-1001'
  });

  assert.equal(result.applies,false);
});

test('demo summary exposes no-model abstention semantics',()=>{
  const state=gracefulAbstentionDemoSummary('pat-1001');

  assert.equal(state.expectedDecision,'ABSTAIN');
  assert.equal(state.execution.modelInvoked,false);
  assert.equal(state.execution.gatewayInvoked,false);
  assert.equal(state.execution.diagnosisProduced,false);
});

test('executive catalog exposes graceful abstention sepsis story',()=>{
  const story=demoCatalog().executiveStories.find(x=>x.id==='graceful-abstention-sepsis');

  assert.ok(story);
  assert.equal(story.patientId,'pat-1001');
  assert.equal(story.actorId,'neph-001');
  assert.equal(story.prompt,'Does this patient have sepsis?');
});
