import { resolveClinicianContext, resolvePatientSupportContext } from './context.mjs';
import { gatewayConfig, invokeModel } from './gateway-client.mjs';

function guardrailDetails(error){
  const message=error?.message && typeof error.message==='object' ? error.message : error;
  return {
    policy:message?.interveningGuardrail||null,
    reasonCode:message?.reasonCode||'GATEWAY_POLICY_BLOCK',
    reason:message?.actionReason||message?.message||'The WSO2 AI Gateway blocked the request.',
    direction:message?.direction||'REQUEST'
  };
}

export async function runGatewayGuardrailProbe({app='clinician',prompt='',actorId,patientId,encounterId,purpose}={}){
  if(gatewayConfig().mode!=='gateway'){
    throw Object.assign(new Error('Live Gateway mode is required for this demo probe.'),{status:503,code:'GATEWAY_MODE_REQUIRED'});
  }
  const cleanPrompt=String(prompt||'').trim();
  if(!cleanPrompt) throw Object.assign(new Error('A prompt is required.'),{status:400,code:'PROMPT_REQUIRED'});
  const context=app==='patient-support'
    ? resolvePatientSupportContext({userId:actorId||'portal-1001',patientId,purpose:purpose||'patient-support'})
    : resolveClinicianContext({actorId:actorId||'clin-001',patientId:patientId||'pat-1001',encounterId:encounterId===undefined?'enc-501':encounterId,purpose:purpose||'encounter-summary'});
  const result=await invokeModel({
    context,
    messages:[{role:'user',content:cleanPrompt}],
    maxTokens:80,
    temperature:0
  });
  if(result.status>=400){
    return {
      decision:'BLOCKED_BY_GATEWAY',
      app,
      context:{actor:context.actor.id,patient:context.patient.pseudonym,purpose:context.purpose},
      gateway:{proxy:result.proxy,status:result.status,model:result.model},
      guardrail:guardrailDetails(result.error)
    };
  }
  return {
    decision:'ALLOWED',
    app,
    context:{actor:context.actor.id,patient:context.patient.pseudonym,purpose:context.purpose},
    gateway:{proxy:result.proxy,status:result.status,model:result.model},
    answer:String(result.message?.content??result.content??'').trim(),
    guardrail:null
  };
}
