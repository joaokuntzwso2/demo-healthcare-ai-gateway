import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {wso2TraceContext} from '../server/services/p1-tracing.mjs';
import {finOpsSnapshot,resetFinOps} from '../server/services/p1-finops.mjs';
import {demoCatalog} from '../server/services/demo-catalog.mjs';
const readChain=async name=>JSON.parse(await readFile(new URL(`../../modular-ai-guardrails/config/${name}`,import.meta.url),'utf8'));
test('P1 chains expose 27 stages with 5 native + 22 Helios stages',async()=>{
  for(const [name,budget] of [['clinical-policy-chain.json',0.05],['patient-support-policy-chain.json',0.02]]){
    const c=await readChain(name),names=c.map(x=>x.name),native=new Set(['api-key-auth','regex-guardrail','llm-cost-based-ratelimit','llm-cost','request-rewrite']);
    assert.equal(names.length,27);assert.equal(names.filter(x=>native.has(x)).length,5);assert.equal(names.filter(x=>!native.has(x)).length,22);
    assert.ok(names.indexOf('canonicalize-and-classify')<names.indexOf('regex-guardrail'));
    assert.ok(names.indexOf('llm-cost-based-ratelimit')<names.indexOf('llm-cost'));
    assert.deepEqual(c.find(x=>x.name==='llm-cost-based-ratelimit').paths[0].params.budgetLimits,[{amount:budget,duration:'24h'}]);
  }
});
test('P1 W3C traceparent uses the evidence UUID as a valid trace ID',()=>{
  const x=wso2TraceContext('123e4567-e89b-12d3-a456-426614174000');
  assert.equal(x.traceId,'123e4567e89b12d3a456426614174000');assert.match(x.traceparent,/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
});
test('P1 FinOps has separate budgets and no invoice claim',()=>{
  resetFinOps();const f=finOpsSnapshot(),c=f.applications.find(x=>x.app==='clinician'),p=f.applications.find(x=>x.app==='patient-support');
  assert.equal(c.configuredBudgetUsd,0.05);assert.equal(p.configuredBudgetUsd,0.02);assert.equal(c.providerInvoice,false);assert.match(f.disclaimer,/not an .*provider invoice/i);
});
test('P1 catalog provenance is derived from the deployed chain',()=>{
  const c=demoCatalog();assert.equal(c.policyScenarios.length,27);assert.equal(c.policyProvenance.wso2Native,5);assert.equal(c.policyProvenance.heliosDomainPolicy,22);assert.equal(c.policyProvenance.applicationAuthority.separate,true);
});
