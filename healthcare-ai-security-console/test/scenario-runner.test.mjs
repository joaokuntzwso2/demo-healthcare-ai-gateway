import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeKnowledge } from '../server/services/knowledge.mjs';
import { runScenario } from '../server/services/scenario-runner.mjs';
import { scenarios } from '../server/scenarios.mjs';

await initializeKnowledge();
for (const s of scenarios) {
  test(`scenario executes: ${s.id}`, async()=>{
    const r=await runScenario(s.id);
    assert.equal(r.scenario.id,s.id);
    assert.ok(r.traceId);
    assert.ok(r.decision);
  });
}
