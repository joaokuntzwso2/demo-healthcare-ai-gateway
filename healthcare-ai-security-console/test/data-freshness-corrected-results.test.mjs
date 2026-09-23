import test from 'node:test';
import assert from 'node:assert/strict';

import {
  labResultLineageForPatient,
  applyCurrentLabProjection,
  deterministicFreshnessNarrative,
  labFreshnessSummary
} from '../server/services/lab-result-lineage.mjs';
import { resolveClinicianContext } from '../server/services/context.mjs';
import { executeTool } from '../server/services/tools.mjs';
import { freshnessAwareNarrative } from '../server/services/copilot.mjs';
import { demoCatalog } from '../server/services/demo-catalog.mjs';

test('potassium has original and corrected versions',()=>{
  const chain=labResultLineageForPatient('pat-1001').resultChains[0];
  const v1=chain.versions.find(v=>v.version===1);
  const v2=chain.versions.find(v=>v.version===2);

  assert.equal(v1.value,5.8);
  assert.equal(v1.status,'SUPERSEDED');
  assert.equal(v1.observedAt,'2026-09-16T08:00:00Z');

  assert.equal(v2.value,4.8);
  assert.equal(v2.status,'CURRENT_CORRECTED');
  assert.equal(v2.current,true);
  assert.equal(v2.issuedAt,'2026-09-16T09:20:00Z');
  assert.equal(v2.corrects,v1.resultVersionId);
});

test('current projection excludes superseded 5.8',()=>{
  const projected=applyCurrentLabProjection('pat-1001',[
    {id:'old-k',code:'SYNTH-K',display:'Potassium',value:5.8,unit:'mmol/L'},
    {id:'cr',code:'SYNTH-CREAT',display:'Creatinine',value:2.1,unit:'mg/dL'}
  ]);

  const potassium=projected.labs.filter(l=>l.code==='SYNTH-K');
  assert.equal(potassium.length,1);
  assert.equal(potassium[0].value,4.8);
  assert.equal(potassium[0].resultVersion,2);
  assert.equal(projected.labs.some(l=>l.code==='SYNTH-K'&&l.value===5.8),false);
});

test('get_recent_labs exposes 4.8 as current plus lineage',()=>{
  const context=resolveClinicianContext({
    actorId:'neph-001',
    patientId:'pat-1001',
    encounterId:null,
    purpose:'lab-review'
  });
  const result=executeTool(context,'get_recent_labs');
  const potassium=result.labs.find(l=>l.code==='SYNTH-K');

  assert.equal(potassium.value,4.8);
  assert.equal(potassium.current,true);
  assert.equal(result.labResultLineage.resultChains[0].versions.length,2);
  assert.ok(result.advisoryCodes.includes('CORRECTED_LAB_RESULT'));
});

test('patient summary cannot expose 5.8 as current',()=>{
  const context=resolveClinicianContext({
    actorId:'neph-001',
    patientId:'pat-1001',
    encounterId:null,
    purpose:'encounter-summary'
  });
  const result=executeTool(context,'get_patient_summary');
  const potassium=(result.labs||[]).filter(l=>l.code==='SYNTH-K');
  assert.equal(potassium.length,1);
  assert.equal(potassium[0].value,4.8);
});

test('unsafe model answer with 5.8 is replaced by corrected narrative',()=>{
  const context=resolveClinicianContext({
    actorId:'neph-001',
    patientId:'pat-1001',
    encounterId:null,
    purpose:'lab-review'
  });
  const result=executeTool(context,'get_recent_labs');

  const projection=freshnessAwareNarrative({
    answer:'The current potassium is 5.8 mmol/L.',
    evidence:[result]
  });

  assert.ok(projection.advisories.includes('CORRECTED_LAB_RESULT'));
  assert.match(projection.answer,/current potassium result is 4\.8 mmol\/L/i);
  assert.match(projection.answer,/originally reported 5\.8 mmol\/L/i);
  assert.match(projection.answer,/corrected version 2 at 09:20/i);
  assert.match(projection.answer,/superseded/i);
});

test('narrative distinguishes 08:00 event from 09:20 correction',()=>{
  const chain=labResultLineageForPatient('pat-1001').resultChains[0];
  const answer=deterministicFreshnessNarrative(chain);
  assert.match(answer,/08:00/);
  assert.match(answer,/09:20/);
});

test('freshness API policy requires current version and provenance',()=>{
  const state=labFreshnessSummary('pat-1001');
  assert.equal(state.currentResult.value,4.8);
  assert.equal(state.currentResult.version,2);
  assert.equal(state.policy.groundedButSupersededMayBeCurrent,false);
  assert.equal(state.policy.currentVersionMustBeSelected,true);
  assert.equal(state.policy.provenanceRequired,true);
});

test('executive catalog exposes freshness story',()=>{
  const story=demoCatalog().executiveStories.find(x=>x.id==='data-freshness-corrected-results');
  assert.ok(story);
  assert.equal(story.patientId,'pat-1001');
  assert.equal(story.actorId,'neph-001');
});
