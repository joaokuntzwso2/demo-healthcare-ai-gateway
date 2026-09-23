import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveClinicianContext } from '../server/services/context.mjs';
import {
  requestBreakGlassAccess,
  completeBreakGlassStepUp,
  revokeBreakGlassAccess,
  breakGlassSummary,
  breakGlassAudit,
  resetBreakGlassDemo,
  forceExpireBreakGlassForTest
} from '../server/services/break-glass.mjs';

const actorId='er-001';
const patientId='pat-1001';

test.beforeEach(()=>resetBreakGlassDemo({actorId,patientId}));

test('ER physician is denied normal patient access before break-glass',()=>{
  assert.throws(
    ()=>resolveClinicianContext({actorId,patientId,encounterId:null,purpose:'encounter-summary'}),
    e=>e.code==='BREAK_GLASS_REQUIRED'
  );
});

test('break-glass requires a meaningful reason',()=>{
  assert.throws(
    ()=>requestBreakGlassAccess({actorId,patientId,reason:'urgent'}),
    e=>e.code==='BREAK_GLASS_REASON_REQUIRED'
  );
});

test('break-glass request creates a step-up challenge but no grant',()=>{
  const request=requestBreakGlassAccess({
    actorId,
    patientId,
    reason:'Emergency evaluation for acute deterioration in the emergency department.'
  });
  assert.equal(request.status,'STEP_UP_REQUIRED');
  assert.equal(request.requiredStepUp,'webauthn');
  assert.equal(breakGlassSummary({actorId,patientId}).activeGrant,null);
});

test('unverified step-up cannot activate break-glass',()=>{
  const request=requestBreakGlassAccess({
    actorId,
    patientId,
    reason:'Emergency evaluation for acute deterioration in the emergency department.'
  });
  assert.throws(
    ()=>completeBreakGlassStepUp({requestId:request.requestId,stepUp:{method:'webauthn',verified:false}}),
    e=>e.code==='BREAK_GLASS_STEP_UP_REQUIRED'
  );
});

test('verified step-up creates temporary access and context records the emergency grant',()=>{
  const request=requestBreakGlassAccess({
    actorId,
    patientId,
    reason:'Emergency evaluation for acute deterioration in the emergency department.'
  });
  const grant=completeBreakGlassStepUp({
    requestId:request.requestId,
    stepUp:{method:'webauthn',verified:true},
    durationSeconds:600
  });
  assert.equal(grant.active,true);
  assert.equal(grant.severity,'HIGH');

  const ctx=resolveClinicianContext({
    actorId,
    patientId,
    encounterId:null,
    purpose:'encounter-summary'
  });

  assert.equal(ctx.breakGlass.active,true);
  assert.equal(ctx.breakGlass.grantId,grant.grantId);
  assert.equal(ctx.patientAssignment.source,'break-glass-emergency');
  assert.equal(ctx.careRelationship.emergencyAccess,true);
  assert.equal(ctx.careRelationship.normalRelationshipActive,false);
});

test('grant request, step-up, grant and use are high-severity audited without raw patient id',()=>{
  const request=requestBreakGlassAccess({
    actorId,
    patientId,
    reason:'Emergency evaluation for acute deterioration in the emergency department.'
  });
  completeBreakGlassStepUp({
    requestId:request.requestId,
    stepUp:{method:'webauthn',verified:true}
  });
  resolveClinicianContext({actorId,patientId,encounterId:null,purpose:'encounter-summary'});

  const events=breakGlassAudit({actorId,patientId,limit:20});
  for(const required of ['BREAK_GLASS_REQUESTED','BREAK_GLASS_STEP_UP_VERIFIED','BREAK_GLASS_GRANTED','BREAK_GLASS_USED']){
    assert.ok(events.some(e=>e.type===required),`missing ${required}`);
  }
  assert.ok(events.every(e=>e.severity==='HIGH'));
  assert.equal(JSON.stringify(events).includes('pat-1001'),false);
});

test('revocation immediately restores normal denial',()=>{
  const request=requestBreakGlassAccess({
    actorId,
    patientId,
    reason:'Emergency evaluation for acute deterioration in the emergency department.'
  });
  completeBreakGlassStepUp({
    requestId:request.requestId,
    stepUp:{method:'webauthn',verified:true}
  });
  revokeBreakGlassAccess({actorId,patientId});
  assert.throws(
    ()=>resolveClinicianContext({actorId,patientId,encounterId:null,purpose:'encounter-summary'}),
    e=>e.code==='BREAK_GLASS_REQUIRED'
  );
});

test('expired grant is removed and creates a high-severity expiry event',()=>{
  const request=requestBreakGlassAccess({
    actorId,
    patientId,
    reason:'Emergency evaluation for acute deterioration in the emergency department.'
  });
  completeBreakGlassStepUp({
    requestId:request.requestId,
    stepUp:{method:'webauthn',verified:true}
  });
  forceExpireBreakGlassForTest({actorId,patientId});
  assert.equal(breakGlassSummary({actorId,patientId}).activeGrant,null);
  assert.ok(breakGlassAudit({actorId,patientId}).some(e=>e.type==='BREAK_GLASS_EXPIRED'&&e.severity==='HIGH'));
});

test('normal assigned clinician access remains unchanged',()=>{
  const ctx=resolveClinicianContext({
    actorId:'neph-001',
    patientId:'pat-1001',
    encounterId:null,
    purpose:'encounter-summary'
  });
  assert.equal(ctx.breakGlass,null);
  assert.equal(ctx.patientAssignment.assigned,true);
});
