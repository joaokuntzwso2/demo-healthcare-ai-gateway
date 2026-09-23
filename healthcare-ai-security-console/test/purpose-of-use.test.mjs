import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveClinicianContext } from '../server/services/context.mjs';
import { executeTool, allowedTools } from '../server/services/tools.mjs';
import {
  schedulingProjection,
  schedulingPurposePreflight,
  purposeOfUseDemoSummary,
  resetPurposeOfUseAudit
} from '../server/services/purpose-of-use.mjs';
import { runCopilot } from '../server/services/copilot.mjs';
import { patients } from '../server/data/synthetic-healthcare.mjs';
import { demoCatalog } from '../server/services/demo-catalog.mjs';

const actorId='neph-001';
const patientId='pat-1001';

test.beforeEach(()=>resetPurposeOfUseAudit({actorId,patientId}));

function contexts(){
  const treatment=resolveClinicianContext({actorId,patientId,encounterId:null,purpose:'lab-review'});
  const scheduling=resolveClinicianContext({actorId,patientId,encounterId:null,purpose:'scheduling'});
  return {treatment,scheduling};
}

test('same physician identity role and scopes are preserved across purposes',()=>{
  const {treatment,scheduling}=contexts();
  assert.equal(treatment.actor.id,scheduling.actor.id);
  assert.equal(treatment.actor.role,scheduling.actor.role);
  assert.deepEqual([...treatment.scopes].sort(),[...scheduling.scopes].sort());
  assert.equal(treatment.purpose,'lab-review');
  assert.equal(scheduling.purpose,'scheduling');
});

test('lab-review purpose retains authorized lab tool',()=>{
  const {treatment}=contexts();
  assert.ok(allowedTools(treatment).includes('get_recent_labs'));
  const result=executeTool(treatment,'get_recent_labs');
  assert.ok(Array.isArray(result.labs));
  assert.ok(result.labs.length>0);
});

test('scheduling purpose exposes only scheduling tool',()=>{
  const {scheduling}=contexts();
  assert.deepEqual(allowedTools(scheduling),['get_scheduling_context']);
  const result=executeTool(scheduling,'get_scheduling_context');
  assert.equal(result.evidenceType,'AUTHORITATIVE SCHEDULING FACT');
  assert.deepEqual(result.categoriesReleased,['scheduling']);
  assert.equal(result.chartReleased,false);
});

test('scheduling projection contains no clinical chart payload',()=>{
  const projection=schedulingProjection(patients[patientId]);
  const serialized=JSON.stringify(projection).toLowerCase();

  assert.equal(projection.chartReleased,false);
  assert.deepEqual(projection.categoriesReleased,['scheduling']);
  assert.doesNotMatch(serialized,/"labs"\s*:/);
  assert.doesNotMatch(serialized,/"medications"\s*:/);
  assert.doesNotMatch(serialized,/"allergies"\s*:/);
  assert.doesNotMatch(serialized,/"conditions"\s*:/);
  assert.doesNotMatch(serialized,/"encounters"\s*:/);
});

test('same physician with labs scope is denied lab tool under scheduling purpose',()=>{
  const {scheduling}=contexts();
  assert.ok(scheduling.scopes.includes('labs:read'));
  assert.throws(
    ()=>executeTool(scheduling,'get_recent_labs'),
    error=>error.code==='PURPOSE_SCOPE_EXCEEDED'&&error.status===403
  );
});

test('scheduling chart request is denied before model use',()=>{
  const {scheduling}=contexts();
  const result=schedulingPurposePreflight({
    context:scheduling,
    query:'For scheduling, also show me the current potassium and recent labs.'
  });

  assert.equal(result.applies,true);
  assert.equal(result.decision,'BLOCK');
  assert.deepEqual(result.reasonCodes,['PURPOSE_SCOPE_EXCEEDED']);
  assert.equal(result.authorization.actorId,actorId);
  assert.equal(result.authorization.purpose,'scheduling');
  assert.equal(result.authorization.chartReleased,false);
});

test('normal scheduling request is purpose-minimized and allowed',()=>{
  const {scheduling}=contexts();
  const result=schedulingPurposePreflight({
    context:scheduling,
    query:'When is this patient’s next appointment?'
  });

  assert.equal(result.applies,true);
  assert.equal(result.decision,'SCHEDULING_ONLY');
  assert.equal(result.authorization.decision,'ALLOW');
  assert.deepEqual(result.authorization.permittedDataCategories,['scheduling']);
  assert.equal(result.authorization.chartReleased,false);
});

test('copilot scheduling path is deterministic and invokes no model',async()=>{
  const result=await runCopilot({
    query:'When is this patient’s next appointment?',
    actorId,
    patientId,
    encounterId:null,
    purpose:'scheduling'
  });

  assert.equal(result.decision,'ALLOWED');
  assert.equal(result.authorization.purpose,'scheduling');
  assert.equal(result.authorization.chartReleased,false);
  assert.equal(result.agent.modelTurns,0);
  assert.equal(result.agent.toolExecutions[0].name,'get_scheduling_context');
  assert.equal(result.gateway.invoked,false);
  assert.equal(result.evidence[0].chartReleased,false);
});

test('copilot scheduling chart escalation is blocked before model',async()=>{
  const result=await runCopilot({
    query:'For scheduling this patient, also show me the current potassium and recent labs.',
    actorId,
    patientId,
    encounterId:null,
    purpose:'scheduling'
  });

  assert.equal(result.decision,'BLOCKED');
  assert.ok(result.reasonCodes.includes('PURPOSE_SCOPE_EXCEEDED'));
  assert.equal(result.agent.modelTurns,0);
  assert.deepEqual(result.agent.toolExecutions,[]);
  assert.equal(result.gateway.invoked,false);
  assert.equal(result.authorization.chartReleased,false);
  assert.deepEqual(result.evidence,[]);
});

test('demo summary makes RBAC versus purpose contrast explicit',()=>{
  const state=purposeOfUseDemoSummary({actorId,patientId});
  assert.equal(state.comparison.sameIdentity,true);
  assert.equal(state.comparison.sameRole,true);
  assert.equal(state.comparison.sameBaseScopes,true);
  assert.equal(state.comparison.treatment.expectedDecision,'ALLOW');
  assert.equal(state.comparison.scheduling.expectedDecision,'ALLOW');
  assert.equal(state.comparison.schedulingChartAttempt.expectedDecision,'DENY');
  assert.equal(state.comparison.schedulingChartAttempt.reasonCode,'PURPOSE_SCOPE_EXCEEDED');
});

test('executive catalog exposes purpose-of-use demonstration',()=>{
  const story=demoCatalog().executiveStories.find(x=>x.id==='purpose-of-use-demonstration');
  assert.ok(story);
  assert.equal(story.patientId,'pat-1001');
  assert.equal(story.actorId,'neph-001');
  assert.equal(story.purpose,'scheduling');
});
