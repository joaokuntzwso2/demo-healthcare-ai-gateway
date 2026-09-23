import test from 'node:test';
import assert from 'node:assert/strict';

import {
  modelToolPayload,
  normalizedPostModelCodes
} from '../server/services/copilot.mjs';

test('model-facing payload strips internal handoff identifiers but keeps clinical facts',()=>{
  const clean=modelToolPayload({
    evidenceType:'AUTHORITATIVE PATIENT FACT',
    patientId:'pat-1003',
    patientPseudonym:'HN-P-4D62B3',
    currentCareContext:{
      phaseId:'cardiology',
      service:'Cardiology',
      currentOwnerActorId:'cardio-001',
      careSetting:'specialty-follow-up'
    },
    encounters:[
      {
        id:'enc-503',
        clinician:'cardio-001',
        reason:'Heart-failure post-discharge review'
      }
    ],
    labs:[
      {
        id:'lab-503-bnp',
        display:'BNP',
        value:780,
        unit:'pg/mL'
      }
    ],
    fhir:{bundle:{resourceType:'Bundle'}}
  });

  const serialized=JSON.stringify(clean);

  assert.equal(serialized.includes('pat-1003'),false);
  assert.equal(serialized.includes('HN-P-4D62B3'),false);
  assert.equal(serialized.includes('cardio-001'),false);
  assert.equal(serialized.includes('"fhir"'),false);
  assert.equal(clean.currentCareContext.service,'Cardiology');
  assert.equal(clean.labs[0].value,780);
});

test('authorized clinician patient narrative may contain clinical facts without being treated as exfiltration',()=>{
  const codes=normalizedPostModelCodes({
    query:'Summarize the patient transition.',
    answer:'George has chronic heart failure. BNP is 780 pg/mL and the current service is Cardiology.',
    context:{app:'clinician'},
    evidence:[{evidenceType:'AUTHORITATIVE PATIENT FACT'}],
    outputCodes:['PHI_PII_SECRET_LEAKAGE'],
    groundingCodes:[]
  });

  assert.deepEqual(codes,[]);
});

test('internal identifiers remain blocked in clinician output',()=>{
  const codes=normalizedPostModelCodes({
    query:'Summarize the patient transition.',
    answer:'Internal patient identifier pat-1003 is assigned to cardio-001.',
    context:{app:'clinician'},
    evidence:[{evidenceType:'AUTHORITATIVE PATIENT FACT'}],
    outputCodes:['PHI_PII_SECRET_LEAKAGE'],
    groundingCodes:[]
  });

  assert.deepEqual(codes,['PHI_PII_SECRET_LEAKAGE']);
});

test('patient-support output does not receive the clinician PHI exception',()=>{
  const codes=normalizedPostModelCodes({
    query:'Tell me about the chart.',
    answer:'George has chronic heart failure.',
    context:{app:'patient-support'},
    evidence:[{evidenceType:'AUTHORITATIVE PATIENT FACT'}],
    outputCodes:['PHI_PII_SECRET_LEAKAGE'],
    groundingCodes:[]
  });

  assert.deepEqual(codes,['PHI_PII_SECRET_LEAKAGE']);
});

test('secrets remain blocked even in an authorized clinician response',()=>{
  const codes=normalizedPostModelCodes({
    query:'Summarize the patient transition.',
    answer:'access_token=super-secret-token-value',
    context:{app:'clinician'},
    evidence:[{evidenceType:'AUTHORITATIVE PATIENT FACT'}],
    outputCodes:['PHI_PII_SECRET_LEAKAGE'],
    groundingCodes:[]
  });

  assert.deepEqual(codes,['PHI_PII_SECRET_LEAKAGE']);
});
