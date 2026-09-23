import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveClinicianContext } from '../server/services/context.mjs';
import { executeTool } from '../server/services/tools.mjs';
import { transitionCareTeamHandoff } from '../server/services/care-team-handoff.mjs';

test('hospitalist handoff summary separates current care ownership from recent encounters',()=>{
  transitionCareTeamHandoff({patientId:'pat-1003',action:'restart'});
  try{
    const ctx=resolveClinicianContext({
      actorId:'hosp-001',
      patientId:'pat-1003',
      encounterId:null,
      purpose:'encounter-summary'
    });

    const summary=executeTool(ctx,'get_patient_summary');

    assert.equal(summary.currentCareContext.phaseId,'inpatient-hospitalist');
    assert.equal(summary.currentCareContext.service,'Hospital Medicine');
    assert.equal(summary.currentCareContext.currentOwnerActorId,'hosp-001');

    for(const encounter of summary.encounters||[]){
      assert.match(
        String(encounter.careContextRelevance||''),
        /not the authoritative current care-owner relationship/i
      );
    }
  }finally{
    transitionCareTeamHandoff({patientId:'pat-1003',action:'reset'});
  }
});

test('summary currentCareContext follows cardiology and PCP handoffs',()=>{
  transitionCareTeamHandoff({patientId:'pat-1003',action:'restart'});
  try{
    transitionCareTeamHandoff({patientId:'pat-1003',action:'next'});

    let ctx=resolveClinicianContext({
      actorId:'cardio-001',
      patientId:'pat-1003',
      encounterId:null,
      purpose:'encounter-summary'
    });
    let summary=executeTool(ctx,'get_patient_summary');

    assert.equal(summary.currentCareContext.phaseId,'cardiology');
    assert.equal(summary.currentCareContext.service,'Cardiology');
    assert.equal(summary.currentCareContext.currentOwnerActorId,'cardio-001');

    transitionCareTeamHandoff({patientId:'pat-1003',action:'next'});

    ctx=resolveClinicianContext({
      actorId:'clin-001',
      patientId:'pat-1003',
      encounterId:null,
      purpose:'encounter-summary'
    });
    summary=executeTool(ctx,'get_patient_summary');

    assert.equal(summary.currentCareContext.phaseId,'outpatient-pcp');
    assert.equal(summary.currentCareContext.currentOwnerActorId,'clin-001');
  }finally{
    transitionCareTeamHandoff({patientId:'pat-1003',action:'reset'});
  }
});
