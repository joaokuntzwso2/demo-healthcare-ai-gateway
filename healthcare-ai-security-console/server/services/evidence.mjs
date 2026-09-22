import crypto from 'node:crypto';
import { safeLogRecord } from './redaction.mjs';
const traces=[];
export function newTrace(context, seed={}){
  const trace={traceId:crypto.randomUUID(),at:new Date().toISOString(),tenant:context.tenant,workforceActor:context.actor.id,role:context.actor.role,patientPseudonymousId:context.patient?.pseudonym||null,encounter:context.encounter||null,purpose:context.purpose,scopes:[...context.scopes],dataCategoriesReleased:[],model:seed.model||'enterprise-openai',promptVersion:'helios-clinical-v1',policyVersion:'helios-gateway-chain-v1',trustedSources:[],safetyServiceResults:[],requestedClinicalAction:null,humanApproval:null,breakGlassState:context.breakGlass?{active:true,expiresAt:context.breakGlass.expiresAt,reasonRecorded:true,elevatedAudit:true}:{active:false},finalDecision:'IN_PROGRESS',reasonCodes:[]};
  traces.unshift(trace); if(traces.length>100) traces.pop(); return trace;
}
export function finalizeTrace(trace, patch={}){ Object.assign(trace,patch); trace.reasonCodes=[...new Set([...(trace.reasonCodes||[]),...(patch.reasonCodes||[])])]; return trace; }
export function listTraces(){ return traces.map(t=>safeLogRecord(t)); }
export function getTrace(id){ const t=traces.find(x=>x.traceId===id); return t?safeLogRecord(t):null; }
export function clearTraces(){ traces.splice(0); }
