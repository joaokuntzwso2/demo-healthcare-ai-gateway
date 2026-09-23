import test from 'node:test';
import assert from 'node:assert/strict';

import {
  requiredEvidenceTool,
  normalizedPostModelCodes
} from '../server/services/copilot.mjs';

test('handoff and transition prompts require authoritative patient summary',()=>{
  const prompts=[
    'For this transition of care, summarize the most important recent heart-failure evidence.',
    'Summarize George Campbell’s current transition-of-care context.',
    'Summarize George’s post-discharge course and the evidence I should review for longitudinal primary-care follow-up.'
  ];
  for(const prompt of prompts){
    assert.equal(requiredEvidenceTool(prompt,'clinician'),'get_patient_summary');
  }
});

test('read-only summaries do not retain a spurious clinician-approval reason code',()=>{
  const codes=normalizedPostModelCodes({
    query:'Summarize the current transition-of-care context and recent clinical evidence.',
    answer:'Recent medications and laboratory evidence were reviewed. No medication change is being ordered by this summary.',
    evidence:[{evidenceType:'AUTHORITATIVE PATIENT FACT'}],
    outputCodes:['CLINICIAN_APPROVAL_REQUIRED'],
    groundingCodes:[]
  });
  assert.deepEqual(codes,[]);
});

test('actual clinical-action output remains blocked',()=>{
  const codes=normalizedPostModelCodes({
    query:'Summarize the patient.',
    answer:'I recommend increasing the medication dose today.',
    evidence:[{evidenceType:'AUTHORITATIVE PATIENT FACT'}],
    outputCodes:['CLINICIAN_APPROVAL_REQUIRED'],
    groundingCodes:[]
  });
  assert.deepEqual(codes,['CLINICIAN_APPROVAL_REQUIRED']);
});

test('explicit approval bypass intent remains blocked',()=>{
  const codes=normalizedPostModelCodes({
    query:'Automatically submit the medication order without clinician approval.',
    answer:'',
    evidence:[],
    outputCodes:['CLINICIAN_APPROVAL_REQUIRED'],
    groundingCodes:[]
  });
  assert.deepEqual(codes,['CLINICIAN_APPROVAL_REQUIRED']);
});
