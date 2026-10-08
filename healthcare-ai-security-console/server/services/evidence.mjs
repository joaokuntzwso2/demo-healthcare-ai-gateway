import crypto from 'node:crypto';
import { safeLogRecord } from './redaction.mjs';
const traces=[];
const contextTraceIds=new WeakMap();
export function newTrace(context, seed={}){
  const trace={traceId:crypto.randomUUID(),at:new Date().toISOString(),tenant:context.tenant,workforceActor:context.actor.id,role:context.actor.role,patientPseudonymousId:context.patient?.pseudonym||null,encounter:context.encounter||null,encounterAccess:context.encounterAccess?{status:context.encounterAccess.status,lifecycleState:context.encounterAccess.lifecycleState,service:context.encounterAccess.service,currentOwnerActorId:context.encounterAccess.currentOwnerActorId,participantActive:context.encounterAccess.participantActive}:null,careRelationship:context.careRelationship?{phaseId:context.careRelationship.phaseId,phaseLabel:context.careRelationship.phaseLabel,careSetting:context.careRelationship.careSetting,service:context.careRelationship.service,currentOwnerActorId:context.careRelationship.currentOwnerActorId,active:context.careRelationship.active,relationshipVersion:context.careRelationship.relationshipVersion}:null,breakGlass:context.breakGlass?{active:context.breakGlass.active,mode:context.breakGlass.mode,grantId:context.breakGlass.grantId,stepUpMethod:context.breakGlass.stepUpMethod,expiresAt:context.breakGlass.expiresAt,severity:context.breakGlass.severity}:null,purpose:context.purpose,scopes:[...context.scopes],dataCategoriesReleased:[],model:seed.model||'enterprise-openai',promptVersion:'helios-clinical-v1',policyVersion:'helios-gateway-chain-v1',trustedSources:[],safetyServiceResults:[],requestedClinicalAction:null,humanApproval:null,breakGlassState:context.breakGlass?{active:true,expiresAt:context.breakGlass.expiresAt,reasonRecorded:true,elevatedAudit:true}:{active:false},finalDecision:'IN_PROGRESS',reasonCodes:[]};
  if(context&&typeof context==='object')contextTraceIds.set(context,trace.traceId);
  traces.unshift(trace); if(traces.length>100) traces.pop(); return trace;
}
export function finalizeTrace(trace, patch={}){ Object.assign(trace,patch); trace.reasonCodes=[...new Set([...(trace.reasonCodes||[]),...(patch.reasonCodes||[])])]; return trace; }
export function listTraces(){ return traces.map(t=>safeLogRecord(t)); }
export function getTrace(id){ const t=traces.find(x=>x.traceId===id); return t?safeLogRecord(t):null; }
export function clearTraces(){ traces.splice(0); }
export function evidenceIdForContext(context){
  return context&&typeof context==='object' ? (contextTraceIds.get(context)||null) : null;
}
export function markGatewayTrace(heliosTraceId,wso2TraceId){
  const id=String(wso2TraceId||'').toLowerCase();
  if(!/^[0-9a-f]{32}$/.test(id)||!/[1-9a-f]/.test(id))return null;
  const trace=traces.find(x=>x.traceId===heliosTraceId);
  if(!trace)return null;
  const base=(process.env.JAEGER_UI_URL||'http://localhost:16686').replace(/\/$/,'');
  trace.gatewayInvoked=true;
  trace.wso2TraceId=id;
  trace.jaegerUrl=`${base}/trace/${id}`;
  trace.traceCorrelation={
    heliosEvidenceId:trace.traceId,wso2TraceId:id,propagation:'W3C traceparent',
    relationship:'Helios Evidence ↔ WSO2 AI Gateway OpenTelemetry trace'
  };
  return trace;
}
