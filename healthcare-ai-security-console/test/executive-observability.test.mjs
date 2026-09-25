import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resetObservability,
  recordModelCall,
  recordCopilotInteraction,
  executiveObservabilitySnapshot,
  observabilityEvents,
  prometheusMetrics
} from '../server/services/observability.mjs';

test('observability starts empty and exposes platform metadata',()=>{
  const s=resetObservability();
  assert.equal(s.requests.total,0);
  assert.equal(s.platform.metrics,'Prometheus');
  assert.equal(s.platform.dashboard,'Grafana');
});

test('allowed and blocked governed requests are counted independently',()=>{
  resetObservability();
  recordCopilotInteraction({args:{app:'clinician',actorId:'neph-001',purpose:'lab-review'},result:{decision:'ALLOWED',traceId:'trace-a',evidence:[{evidenceType:'AUTHORITATIVE PATIENT FACT'}],reasonCodes:[]},durationMs:120});
  recordCopilotInteraction({args:{app:'clinician',actorId:'neph-001',purpose:'lab-review'},result:{decision:'BLOCKED',traceId:'trace-b',reasonCodes:['JAILBREAK_OR_AUTHORITY_BYPASS'],gateway:{invoked:false}},durationMs:4});
  const s=executiveObservabilitySnapshot();
  assert.equal(s.requests.total,2);
  assert.equal(s.requests.allowed,1);
  assert.equal(s.requests.blocked,1);
});

test('abstentions and grounding withholding are explicit metrics',()=>{
  resetObservability();
  recordCopilotInteraction({args:{app:'clinician',actorId:'neph-001'},result:{decision:'ABSTAIN',reasonCodes:['TRUSTED_CLINICAL_SOURCE_REQUIRED'],evidence:[],agent:{modelTurns:1,toolExecutions:[]}},durationMs:80});
  const s=executiveObservabilitySnapshot();
  assert.equal(s.requests.abstained,1);
  assert.equal(s.grounding.withheld,1);
});

test('tool calls use professional role but never patient identity labels',()=>{
  resetObservability();
  recordCopilotInteraction({args:{app:'clinician',actorId:'neph-001',patientId:'pat-1001'},result:{decision:'ALLOWED',evidence:[{}],agent:{modelTurns:2,toolExecutions:[{name:'get_recent_labs',status:'OK'}]}},durationMs:200});
  const text=prometheusMetrics();
  assert.match(text,/helios_ai_tools_total/);
  assert.match(text,/tool="get_recent_labs"/);
  assert.doesNotMatch(text,/pat-1001|Marcus Reed/);
});

test('provider-reported token usage is exposed by model and proxy',()=>{
  resetObservability();
  recordModelCall({context:{app:'clinician'},proxy:'clinical-ai-secure',model:'gpt-4o-mini',status:200,latencyMs:340,usage:{inputTokens:120,outputTokens:40,totalTokens:160}});
  const s=executiveObservabilitySnapshot();
  assert.equal(s.model.calls,1);
  assert.equal(s.model.totalTokens,160);
  const text=prometheusMetrics();
  assert.match(text,/helios_ai_model_tokens_total/);
  assert.match(text,/type="total"/);
});

test('WSO2 guardrail interventions retain policy and reason without request body',()=>{
  resetObservability();
  recordModelCall({context:{app:'clinician'},proxy:'clinical-ai-secure',model:'gpt-4o-mini',status:422,latencyMs:12,error:{message:{interveningGuardrail:'custom-tool-delegation-guard',reasonCode:'PROFESSIONAL_ROLE_CAPABILITY_DENIED'}}});
  const text=prometheusMetrics();
  assert.match(text,/custom-tool-delegation-guard/);
  assert.match(text,/PROFESSIONAL_ROLE_CAPABILITY_DENIED/);
  assert.doesNotMatch(text,/prompt|patientId/);
});

test('request and model latency are exported as Prometheus histograms',()=>{
  resetObservability();
  recordCopilotInteraction({args:{app:'clinician'},result:{decision:'ALLOWED'},durationMs:420});
  recordModelCall({context:{app:'clinician'},proxy:'clinical-ai-secure',model:'gpt-4o-mini',status:200,latencyMs:300});
  const text=prometheusMetrics();
  assert.match(text,/# TYPE helios_ai_request_duration_seconds histogram/);
  assert.match(text,/helios_ai_request_duration_seconds_bucket/);
  assert.match(text,/# TYPE helios_ai_model_call_duration_seconds histogram/);
});

test('recent governance stream is minimized',()=>{
  resetObservability();
  recordCopilotInteraction({args:{app:'clinician',actorId:'neph-001',patientId:'pat-1001',query:'sensitive prompt'},result:{decision:'BLOCKED',traceId:'trace-z',reasonCodes:['CLINICAL_DATA_NOT_AUTHORIZED']},durationMs:2});
  const events=observabilityEvents();
  const serialized=JSON.stringify(events);
  assert.match(serialized,/trace-z/);
  assert.doesNotMatch(serialized,/pat-1001|sensitive prompt/);
});

test('executive snapshot includes p50 p95 p99 and ranked governance views',()=>{
  resetObservability();
  for(const ms of [10,80,250,800])recordCopilotInteraction({args:{app:'clinician'},result:{decision:'ALLOWED',agent:{toolExecutions:[{name:'get_recent_labs',status:'OK'}]},evidence:[{}]},durationMs:ms});
  const s=executiveObservabilitySnapshot();
  assert.ok(s.latencyMs.p50>0);
  assert.ok(s.latencyMs.p95>=s.latencyMs.p50);
  assert.equal(s.topTools[0].name,'get_recent_labs');
});
