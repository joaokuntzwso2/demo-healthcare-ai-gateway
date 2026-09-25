import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveClinicianContext } from '../server/services/context.mjs';
import { allowedTools, executeTool, clinicianTools } from '../server/services/tools.mjs';
import { requestMedicationOrder } from '../server/services/actions.mjs';
import { professionalRoleFamily, professionalRolePolicyForContext } from '../server/services/professional-role-policy.mjs';
import { ROLE_DEMO_QUESTION, roleBasedDifferencesSummary, evaluateRole, resetRoleBasedAudit, roleBasedAudit } from '../server/services/role-based-differences.mjs';
import { demoCatalog } from '../server/services/demo-catalog.mjs';

const ctx=id=>resolveClinicianContext({actorId:id,patientId:'pat-1001',encounterId:null,purpose:'medication-review'});

test('four professional roles share the same patient relationship for the comparison',()=>{
  for(const id of ['neph-001','pharm-001','nurse-001','care-001']){
    const c=ctx(id);
    assert.equal(c.patient.id,'pat-1001');
    assert.equal(c.tenant,'helios-north');
  }
});

test('professional role families are deterministic',()=>{
  assert.equal(professionalRoleFamily('attending-physician'),'physician');
  assert.equal(professionalRoleFamily('clinical-pharmacist'),'pharmacist');
  assert.equal(professionalRoleFamily('registered-nurse'),'nurse');
  assert.equal(professionalRoleFamily('care-manager'),'care-manager');
});

test('physician receives broad review plus approval-bound action request capabilities',()=>{
  const tools=allowedTools(ctx('neph-001'));
  for(const name of ['get_patient_summary','get_recent_labs','get_medications','get_conditions','request_medication_order','request_test_order','submit_for_clinician_approval']){
    assert.ok(tools.includes(name),name);
  }
});

test('pharmacist receives medication review and safety but not physician action or note authority',()=>{
  const tools=allowedTools(ctx('pharm-001'));
  for(const name of ['get_recent_labs','get_medications','get_allergies','get_conditions','check_medication_safety'])assert.ok(tools.includes(name),name);
  for(const denied of ['get_patient_summary','draft_clinical_note','request_medication_order','request_test_order','submit_for_clinician_approval'])assert.equal(tools.includes(denied),false,denied);
});

test('nurse receives summary labs allergies and note draft but no medication or order capability',()=>{
  const tools=allowedTools(ctx('nurse-001'));
  for(const name of ['get_patient_summary','get_encounter','get_recent_labs','get_allergies','draft_clinical_note'])assert.ok(tools.includes(name),name);
  for(const denied of ['get_medications','get_conditions','request_medication_order','request_test_order','submit_for_clinician_approval'])assert.equal(tools.includes(denied),false,denied);
});

test('care manager is limited to coordination-oriented clinical capabilities',()=>{
  const tools=allowedTools(ctx('care-001'));
  for(const name of ['get_patient_summary','get_encounter','search_clinical_knowledge','draft_clinical_note'])assert.ok(tools.includes(name),name);
  for(const denied of ['get_recent_labs','get_medications','get_allergies','get_conditions','check_medication_safety','request_medication_order'])assert.equal(tools.includes(denied),false,denied);
});

test('scope cannot escalate a professional role beyond its responsibility',()=>{
  const base=ctx('pharm-001');
  const pharmacist={...base,scopes:[...base.scopes,'clinical-action:request','note:draft']};
  const policy=professionalRolePolicyForContext(pharmacist,clinicianTools);
  assert.equal(policy.allowedTools.includes('request_medication_order'),false);
  assert.equal(policy.allowedTools.includes('draft_clinical_note'),false);
});

test('server tool execution independently blocks role-forbidden capabilities',()=>{
  assert.throws(()=>executeTool(ctx('nurse-001'),'get_medications'),e=>e?.code==='PROFESSIONAL_ROLE_CAPABILITY_DENIED');
  assert.throws(()=>executeTool(ctx('pharm-001'),'draft_clinical_note'),e=>e?.code==='PROFESSIONAL_ROLE_CAPABILITY_DENIED');
  assert.throws(()=>executeTool(ctx('care-001'),'get_recent_labs'),e=>e?.code==='PROFESSIONAL_ROLE_CAPABILITY_DENIED');
});

test('action service independently denies non-physician order authority',()=>{
  const base=ctx('pharm-001');
  const c={...base,scopes:[...base.scopes,'clinical-action:request']};
  assert.throws(()=>requestMedicationOrder(c,{medication:'SYNTH-MED-A',dose:1,unit:'demo-unit'}),e=>e?.code==='PROFESSIONAL_ROLE_CAPABILITY_DENIED');
});

test('same question evaluates to different permitted capabilities',()=>{
  const physician=evaluateRole('neph-001');
  const pharmacist=evaluateRole('pharm-001');
  const nurse=evaluateRole('nurse-001');
  const care=evaluateRole('care-001');
  for(const x of [physician,pharmacist,nurse,care])assert.equal(x.question,ROLE_DEMO_QUESTION);
  assert.equal(physician.capabilityMatrix.medicationOrderRequest,true);
  assert.equal(pharmacist.capabilityMatrix.medicationSafety,true);
  assert.equal(pharmacist.capabilityMatrix.medicationOrderRequest,false);
  assert.equal(nurse.capabilityMatrix.labs,true);
  assert.equal(nurse.capabilityMatrix.medications,false);
  assert.equal(care.capabilityMatrix.labs,false);
  assert.equal(care.capabilityMatrix.medicationOrderRequest,false);
});

test('role comparison summary keeps patient tenant purpose and question constant',()=>{
  const s=roleBasedDifferencesSummary();
  assert.equal(s.roles.length,4);
  assert.equal(s.invariant.samePatient,true);
  assert.equal(s.invariant.sameTenant,true);
  assert.equal(s.invariant.samePurpose,true);
  assert.equal(s.invariant.sameQuestion,true);
  assert.equal(s.invariant.purpose,'medication-review');
});

test('role audit stores authorization metadata without clinical record content',()=>{
  resetRoleBasedAudit();
  evaluateRole('nurse-001');
  const events=roleBasedAudit({actorId:'nurse-001'});
  assert.ok(events.length>=1);
  const serialized=JSON.stringify(events);
  assert.doesNotMatch(serialized,/Potassium|Creatinine|Synthetic ACE|Marcus Reed/);
});

test('executive catalog exposes role-based differences story',()=>{
  const story=demoCatalog().executiveStories.find(x=>x.id==='professional-role-differences');
  assert.ok(story);
  assert.equal(story.page,'Role Differences');
  assert.equal(story.vpLens,'Professional responsibility');
});


test('behavioral-health role preserves explicitly authorized restricted-record access',()=>{
  const c=resolveClinicianContext({
    actorId:'bh-001',
    patientId:'pat-1004',
    encounterId:null,
    purpose:'behavioral-health-treatment'
  });

  const tools=allowedTools(c);

  assert.equal(
    tools.includes('get_restricted_clinical_information'),
    true
  );
});


test('restricted capability is not granted by scope alone',()=>{
  const ordinary=resolveClinicianContext({
    actorId:'endo-001',
    patientId:'pat-1004',
    encounterId:null,
    purpose:'behavioral-health-treatment'
  });

  const scopeOnly={
    ...ordinary,
    scopes:[
      ...new Set([
        ...(ordinary.scopes||[]),
        'restricted:behavioral-health:read'
      ])
    ]
  };

  /*
   * Even though the role filter itself recognizes the restricted scope,
   * the authoritative execution layer must still reject because Mateo
   * does not have the dedicated patient authorization.
   */
  assert.throws(
    ()=>executeTool(
      scopeOnly,
      'get_restricted_clinical_information'
    ),
    e=>
      e?.code==='RESTRICTED_RECORD_ACCESS_DENIED' ||
      e?.code==='CLINICAL_DATA_NOT_AUTHORIZED'
  );
});
