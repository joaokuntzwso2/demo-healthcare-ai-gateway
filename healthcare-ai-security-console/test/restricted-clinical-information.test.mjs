import test from 'node:test';
import assert from 'node:assert/strict';

import { patients } from '../server/data/synthetic-healthcare.mjs';
import { resolveClinicianContext } from '../server/services/context.mjs';
import { executeTool, allowedTools } from '../server/services/tools.mjs';
import {
  RESTRICTED_PURPOSE,
  RESTRICTED_TOOL,
  restrictedAuthorizationProjection,
  restrictedClinicalPreflight,
  readRestrictedClinicalInformation,
  resetRestrictedClinicalInformation,
  setRestrictedAuthorizationState,
  restrictedClinicalAudit
} from '../server/services/restricted-clinical-information.mjs';

test.beforeEach(()=>resetRestrictedClinicalInformation());

test('ordinary assigned endocrinologist retains normal chart relationship but not restricted access',()=>{
  const context=resolveClinicianContext({
    actorId:'endo-001',
    patientId:'pat-1004',
    encounterId:null,
    purpose:RESTRICTED_PURPOSE
  });
  const auth=restrictedAuthorizationProjection({
    actorId:context.actor.id,
    patientId:context.patient.id,
    purpose:context.purpose,
    scopes:context.scopes
  });
  assert.equal(auth.careRelationship,true);
  assert.equal(auth.ordinaryChartAccess,true);
  assert.equal(auth.scopePresent,false);
  assert.equal(auth.patientAuthorizationPresent,false);
  assert.equal(auth.active,false);
  assert.equal(allowedTools(context).includes(RESTRICTED_TOOL),false);
});

test('unauthorized restricted request is stopped before model and gateway invocation',()=>{
  const context=resolveClinicianContext({
    actorId:'endo-001',
    patientId:'pat-1004',
    encounterId:null,
    purpose:RESTRICTED_PURPOSE
  });
  const result=restrictedClinicalPreflight({
    context,
    query:'Summarize the restricted behavioral-health record.'
  });
  assert.equal(result.applies,true);
  assert.equal(result.decision,'BLOCK');
  assert.deepEqual(result.reasonCodes,['RESTRICTED_RECORD_ACCESS_DENIED']);
  assert.equal(result.authorization.segmentReleased,false);
});

test('authorized behavioral-health clinician receives the restricted tool only with active authorization',()=>{
  const context=resolveClinicianContext({
    actorId:'bh-001',
    patientId:'pat-1004',
    encounterId:null,
    purpose:RESTRICTED_PURPOSE
  });
  assert.equal(context.restrictedAuthorization.active,true);
  assert.equal(allowedTools(context).includes(RESTRICTED_TOOL),true);
  const evidence=executeTool(context,RESTRICTED_TOOL);
  assert.equal(evidence.evidenceType,'AUTHORITATIVE RESTRICTED PATIENT FACT');
  assert.equal(evidence.source,'EHR-RESTRICTED-BEHAVIORAL-HEALTH');
  assert.deepEqual(evidence.categoriesReleased,['restricted:behavioral-health']);
  assert.equal(evidence.authorization.patientAuthorizationVerified,true);
});

test('revoking patient authorization immediately removes restricted access',()=>{
  setRestrictedAuthorizationState({action:'revoke'});
  const context=resolveClinicianContext({
    actorId:'bh-001',
    patientId:'pat-1004',
    encounterId:null,
    purpose:RESTRICTED_PURPOSE
  });
  assert.equal(context.restrictedAuthorization.active,false);
  assert.equal(allowedTools(context).includes(RESTRICTED_TOOL),false);
  assert.throws(
    ()=>readRestrictedClinicalInformation(context),
    error=>error?.code==='RESTRICTED_RECORD_ACCESS_DENIED'
  );
});

test('restoring patient authorization restores access',()=>{
  setRestrictedAuthorizationState({action:'revoke'});
  setRestrictedAuthorizationState({action:'restore'});
  const context=resolveClinicianContext({
    actorId:'bh-001',
    patientId:'pat-1004',
    encounterId:null,
    purpose:RESTRICTED_PURPOSE
  });
  assert.equal(context.restrictedAuthorization.active,true);
  assert.doesNotThrow(()=>readRestrictedClinicalInformation(context));
});

test('purpose mismatch denies the restricted segment even for the authorized specialist',()=>{
  const context=resolveClinicianContext({
    actorId:'bh-001',
    patientId:'pat-1004',
    encounterId:null,
    purpose:'encounter-summary'
  });
  assert.equal(context.restrictedAuthorization.scopePresent,true);
  assert.equal(context.restrictedAuthorization.patientAuthorizationPresent,true);
  assert.equal(context.restrictedAuthorization.purposeAuthorized,false);
  assert.equal(context.restrictedAuthorization.active,false);
});

test('ordinary patient chart contains no restricted behavioral-health object',()=>{
  const patient=patients['pat-1004'];
  const serialized=JSON.stringify(patient);
  assert.equal(serialized.includes('EHR-RESTRICTED-BEHAVIORAL-HEALTH'),false);
  assert.equal(serialized.includes('restricted-bh-followup-1004'),false);
});

test('restricted audit stores decision metadata but not the restricted record body',()=>{
  const context=resolveClinicianContext({
    actorId:'bh-001',
    patientId:'pat-1004',
    encounterId:null,
    purpose:RESTRICTED_PURPOSE
  });
  readRestrictedClinicalInformation(context);
  const events=restrictedClinicalAudit({actorId:'bh-001',patientId:'pat-1004'});
  assert.ok(events.length>0);
  const serialized=JSON.stringify(events);
  assert.equal(serialized.includes('Synthetic behavioral-health follow-up record'),false);
  assert.equal(serialized.includes('Continue clinician-directed behavioral-health follow-up'),false);
});
