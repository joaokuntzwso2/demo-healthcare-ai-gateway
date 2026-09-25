import crypto from 'node:crypto';
import { patients, workforce } from '../data/synthetic-healthcare.mjs';
import { resolveClinicianContext } from './context.mjs';
import { allowedTools, clinicianTools } from './tools.mjs';
import { professionalRolePolicyForContext, PROFESSIONAL_ROLE_POLICY, PROFESSIONAL_ROLE_POLICY_VERSION } from './professional-role-policy.mjs';
import { runCopilot } from './copilot.mjs';
import { invokeModel, gatewayConfig } from './gateway-client.mjs';
import { schemasForToolNames } from './tool-schemas.mjs';

export const ROLE_DEMO_PATIENT='pat-1001';
export const ROLE_DEMO_QUESTION="Review this patient's current renal function and medication context. What information can you retrieve and what clinical actions, if any, are you permitted to request?";
export const ROLE_DEMO_ACTORS=[
  {id:'neph-001',persona:'Physician'},
  {id:'pharm-001',persona:'Pharmacist'},
  {id:'nurse-001',persona:'Nurse'},
  {id:'care-001',persona:'Care manager'}
];

const auditEvents=[];
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function now(){return new Date().toISOString();}
function contextFor(actorId){
  return resolveClinicianContext({actorId,patientId:ROLE_DEMO_PATIENT,encounterId:null,purpose:'medication-review'});
}
function capabilityRow(context){
  const tools=allowedTools(context);
  const policy=professionalRolePolicyForContext(context,clinicianTools);
  const has=x=>tools.includes(x);
  return {
    actor:{id:context.actor.id,display:context.actor.display,role:context.actor.role,specialty:workforce[context.actor.id]?.specialty||null,professionalRole:context.professionalRole},
    signedScopes:[...context.scopes],
    allowedTools:tools,
    deniedTools:policy.deniedTools,
    capabilityMatrix:{
      clinicalSummary:has('get_patient_summary'),
      labs:has('get_recent_labs'),
      medications:has('get_medications'),
      allergies:has('get_allergies'),
      conditions:has('get_conditions'),
      medicationSafety:has('check_medication_safety'),
      noteDrafting:has('draft_clinical_note'),
      medicationOrderRequest:has('request_medication_order'),
      testOrderRequest:has('request_test_order'),
      clinicianApproval:has('submit_for_clinician_approval')
    },
    actionAuthority:policy.actionAuthority,
    responsibility:policy.responsibility
  };
}

export function roleBasedDifferencesSummary(){
  const patient=patients[ROLE_DEMO_PATIENT];
  return {
    title:'Role-based differences',
    question:ROLE_DEMO_QUESTION,
    patient:{display:patient.name,pseudonym:patient.pseudonym,tenant:patient.tenant},
    invariant:{samePatient:true,sameTenant:true,samePurpose:true,sameQuestion:true,purpose:'medication-review',policy:PROFESSIONAL_ROLE_POLICY,version:PROFESSIONAL_ROLE_POLICY_VERSION},
    roles:ROLE_DEMO_ACTORS.map(x=>capabilityRow(contextFor(x.id))),
    principle:'The AI receives only the capabilities permitted for the authenticated professional role. Role policy is intersected with signed scopes and purpose-of-use; the model never becomes a universal clinical super-user.'
  };
}

export function evaluateRole(actorId){
  if(!ROLE_DEMO_ACTORS.some(x=>x.id===actorId)){
    throw Object.assign(new Error('Actor is not part of the role-comparison fixture.'),{status:400,code:'INVALID_ROLE_DEMO_ACTOR'});
  }
  const row=capabilityRow(contextFor(actorId));
  const requiredCapability='get_recent_labs';
  const result={...row,question:ROLE_DEMO_QUESTION,patient:{display:patients[ROLE_DEMO_PATIENT].name,pseudonym:patients[ROLE_DEMO_PATIENT].pseudonym},requiredCapability,canSatisfyRequiredEvidence:row.allowedTools.includes(requiredCapability),modelWouldReceiveTools:[...row.allowedTools]};
  auditEvents.unshift({eventId:`role-${crypto.randomUUID()}`,at:now(),type:'PROFESSIONAL_ROLE_AUTHORIZATION',actorId,actorRole:row.actor.role,professionalRole:row.actor.professionalRole?.family||null,decision:result.canSatisfyRequiredEvidence?'ALLOW_REQUIRED_EVIDENCE':'DENY_REQUIRED_EVIDENCE',requiredCapability,allowedToolCount:row.allowedTools.length});
  if(auditEvents.length>250)auditEvents.length=250;
  return result;
}

export async function runSameQuestionForRole(actorId){
  const evaluation=evaluateRole(actorId);
  const result=await runCopilot({app:'clinician',query:ROLE_DEMO_QUESTION,actorId,patientId:ROLE_DEMO_PATIENT,encounterId:null,purpose:'medication-review'});
  auditEvents.unshift({eventId:`role-query-${crypto.randomUUID()}`,at:now(),type:'ROLE_BOUND_AI_QUERY',actorId,actorRole:evaluation.actor.role,professionalRole:evaluation.actor.professionalRole?.family||null,decision:result.decision,reasonCodes:[...(result.reasonCodes||[])],modelTurns:result.agent?.modelTurns||0,toolNames:(result.agent?.toolExecutions||result.toolExecutions||[]).map(x=>x.name)});
  if(auditEvents.length>250)auditEvents.length=250;
  return {evaluation,result};
}

function guardrailDetails(result){
  const message=result?.error?.message&&typeof result.error.message==='object'?result.error.message:result?.error;
  return {policy:message?.interveningGuardrail||null,reasonCode:message?.reasonCode||message?.code||'GATEWAY_POLICY_BLOCK',reason:message?.actionReason||message?.message||'The WSO2 AI Gateway blocked the request.',direction:message?.direction||'REQUEST'};
}
const NEGATIVE_PROBE_TOOL={'pharm-001':'draft_clinical_note','nurse-001':'request_medication_order','care-001':'get_recent_labs'};

export async function runRoleGatewayProbe(actorId){
  if(gatewayConfig().mode!=='gateway')throw Object.assign(new Error('Live Gateway mode is required for the professional-role probe.'),{status:503,code:'GATEWAY_MODE_REQUIRED'});
  const toolName=NEGATIVE_PROBE_TOOL[actorId];
  if(!toolName)throw Object.assign(new Error('Gateway role-denial probe is defined for pharmacist, nurse and care manager.'),{status:400,code:'INVALID_ROLE_GATEWAY_PROBE'});
  /*
   * The direct Gateway probe must isolate PROFESSIONAL ROLE enforcement.
   *
   * The care manager intentionally cannot satisfy the medication-review
   * purpose contract, so using medication-review would correctly stop
   * earlier at custom-purpose-scope-guard.
   *
   * For that one defense-in-depth probe we use care-coordination, then
   * deliberately offer get_recent_labs. The request therefore reaches
   * custom-tool-delegation-guard, which must deny the tool because the
   * signed professional role is care-manager.
   */
  const context=actorId==='care-001'
    ?resolveClinicianContext({
        actorId,
        patientId:ROLE_DEMO_PATIENT,
        encounterId:null,
        purpose:'care-coordination'
      })
    :contextFor(actorId);

  const tools=schemasForToolNames([toolName]);
  if(tools.length!==1)throw new Error(`Tool schema missing for ${toolName}.`);
  const result=await invokeModel({context,messages:[{role:'system',content:'Synthetic professional-role authorization probe.'},{role:'user',content:'Capability exposure test only.'}],tools,maxTokens:30,temperature:0});
  const guardrail=guardrailDetails(result);
  const blocked=result.status>=400;
  auditEvents.unshift({eventId:`role-gateway-${crypto.randomUUID()}`,at:now(),type:'PROFESSIONAL_ROLE_GATEWAY_PROBE',actorId,actorRole:context.actor.role,professionalRole:context.professionalRole?.family||null,toolName,decision:blocked?'BLOCKED_BY_GATEWAY':'ALLOWED',reasonCode:blocked?guardrail.reasonCode:null});
  if(auditEvents.length>250)auditEvents.length=250;
  return {decision:blocked?'BLOCKED_BY_GATEWAY':'ALLOWED',actor:{id:context.actor.id,display:context.actor.display,role:context.actor.role,professionalRole:context.professionalRole},attemptedTool:toolName,gateway:{proxy:result.proxy,status:result.status,model:result.model},guardrail:blocked?guardrail:null,providerInvoked:!blocked};
}
export function roleBasedAudit({actorId=null,limit=50}={}){
  return auditEvents.filter(x=>!actorId||x.actorId===actorId).slice(0,Math.max(1,Math.min(Number(limit)||50,100))).map(clone);
}
export function resetRoleBasedAudit(){auditEvents.length=0;return roleBasedDifferencesSummary();}
