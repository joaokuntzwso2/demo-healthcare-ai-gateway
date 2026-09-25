import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeKnowledge } from './services/knowledge.mjs';
import { listTraces, getTrace } from './services/evidence.mjs';
import { gatewayConfig } from './services/gateway-client.mjs';
import { clinicianTools, patientTools } from './services/tools.mjs';
import { runCopilot } from './services/copilot.mjs';
import { gatewayRuntimeStatus } from './services/runtime-status.mjs';
import { runGatewayGuardrailProbe } from './services/demo-journey.mjs';
import { demoCatalog } from './services/demo-catalog.mjs';
import { encounterLifecycleSummary, transitionEncounterLifecycle } from './services/encounter-lifecycle.mjs';
import { careTeamHandoffSummary, transitionCareTeamHandoff } from './services/care-team-handoff.mjs';
import { requestBreakGlassAccess, completeBreakGlassStepUp, revokeBreakGlassAccess, breakGlassSummary, breakGlassAudit, resetBreakGlassDemo } from './services/break-glass.mjs';
import { clinicalEvidenceConflictSummary } from './services/clinical-evidence-conflict.mjs';
import { labFreshnessSummary } from './services/lab-result-lineage.mjs';
import { createHumanApprovalProposal, reviewHumanApprovalProposal, humanApprovalSummary, humanApprovalAudit, resetHumanApprovalWorkflow } from './services/human-approval-workflow.mjs';
import { gracefulAbstentionDemoSummary } from './services/clinical-context-completeness.mjs';
import { startMedicationReconciliation, submitMedicationReconciliation, medicationReconciliationSummary, medicationReconciliationAudit, resetMedicationReconciliation } from './services/medication-reconciliation-workflow.mjs';
import { purposeOfUseDemoSummary, purposeOfUseAudit, resetPurposeOfUseAudit } from './services/purpose-of-use.mjs';
import { restrictedClinicalInformationSummary, restrictedClinicalAudit, setRestrictedAuthorizationState, resetRestrictedClinicalInformation } from './services/restricted-clinical-information.mjs';

import { tenantIsolationSummary, resolveTenantScopedPatient, tenantIsolationAudit, resetTenantIsolationAudit, runCrossTenantGatewayProbe } from './services/multi-tenant-isolation.mjs';
import { roleBasedDifferencesSummary, evaluateRole, runSameQuestionForRole, runRoleGatewayProbe, roleBasedAudit, resetRoleBasedAudit } from './services/role-based-differences.mjs';
import { clinicalKnowledgeLifecycleSummary, retrieveActiveClinicalGuideline, inspectKnowledgeLifecycleSource, resetClinicalKnowledgeLifecycle, runKnowledgeLifecycleGatewayProbe, clinicalKnowledgeLifecycleAudit } from './services/clinical-knowledge-lifecycle.mjs';
const ROOT=resolve(fileURLToPath(new URL('../',import.meta.url)));
const UI=resolve(ROOT,process.env.NODE_ENV==='production'?'dist':'public');
const PORT=Number(process.env.PORT||5173);
await initializeKnowledge();

const json=(res,status,body)=>{const data=JSON.stringify(body,null,2);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(data)};
async function body(req,limit=1024*1024){let d='';for await(const c of req){d+=c;if(Buffer.byteLength(d)>limit)throw Object.assign(new Error('Payload too large'),{status:413});}return d;}
async function jsonBody(req){const d=await body(req);return d?JSON.parse(d):{};}

const architecture={
  flow:['REQUEST','SIGNED CONTEXT','WSO2 AI GATEWAY','MODEL REASONING','SERVER TOOL','AUTHORITATIVE SOURCE','GROUNDED RESPONSE','AUDIT TRACE'],
  trustBoundaries:[
    {label:'PATIENT DATA',state:'AUTHORITATIVE'},
    {label:'CLINICAL KNOWLEDGE',state:'TRUSTED / VERSIONED'},
    {label:'LLM OUTPUT',state:'GENERATED / VALIDATED'},
    {label:'CLINICAL ACTION',state:'HUMAN-GATED'}
  ],
  applications:{clinician:{proxy:'clinical-ai-secure',tools:clinicianTools},patientSupport:{proxy:'patient-support-ai-secure',tools:patientTools}},
  principle:'The model reasons inside bounded application contexts. Identity, clinical facts, tool authority, policy enforcement and action approval remain deterministic and server-controlled.'
};

// These legacy fixture APIs are intentionally unavailable to the presentation UI.
// The demo surface must exercise governed AI flows rather than reading mock/reference stores directly.
const retiredFixtureRoutes=new Set(['/api/overview','/api/scenarios','/api/knowledge','/api/knowledge/ingest','/api/reference-data']);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};

const server=http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&u.pathname==='/api/health')return json(res,200,{ok:true,product:'Helios Clinical AI Security',gateway:gatewayConfig()});
  if(req.method==='GET'&&u.pathname==='/api/gateway-status')return json(res,200,await gatewayRuntimeStatus());
  if(req.method==='GET'&&u.pathname==='/api/demo/catalog')return json(res,200,demoCatalog());
  if(req.method==='GET'&&u.pathname==='/api/demo/clinical-knowledge-lifecycle')return json(res,200,clinicalKnowledgeLifecycleSummary());
  if(req.method==='GET'&&u.pathname==='/api/demo/clinical-knowledge-lifecycle/audit')return json(res,200,{events:clinicalKnowledgeLifecycleAudit({limit:50})});
  if(req.method==='POST'&&u.pathname==='/api/demo/clinical-knowledge-lifecycle'){
    const b=await jsonBody(req);
    if(b.action==='reset')return json(res,200,await resetClinicalKnowledgeLifecycle());
    if(b.action==='retrieve-active')return json(res,200,retrieveActiveClinicalGuideline(b));
    if(b.action==='inspect')return json(res,200,inspectKnowledgeLifecycleSource(b.kind));
    if(b.action==='gateway-probe')return json(res,200,await runKnowledgeLifecycleGatewayProbe(b.kind));
    return json(res,400,{error:'Unsupported clinical-knowledge-lifecycle action',code:'INVALID_KNOWLEDGE_LIFECYCLE_ACTION'});
  }

  if(req.method==='GET'&&u.pathname==='/api/demo/role-based-differences')return json(res,200,roleBasedDifferencesSummary());
  if(req.method==='GET'&&u.pathname==='/api/demo/role-based-differences/audit')return json(res,200,{events:roleBasedAudit({actorId:u.searchParams.get('actorId')||null,limit:50})});
  if(req.method==='POST'&&u.pathname==='/api/demo/role-based-differences'){
    const b=await jsonBody(req);
    if(b.action==='reset')return json(res,200,resetRoleBasedAudit());
    if(b.action==='evaluate')return json(res,200,evaluateRole(b.actorId));
    if(b.action==='ask')return json(res,200,await runSameQuestionForRole(b.actorId));
    return json(res,400,{error:'Unsupported role-differences action',code:'INVALID_ROLE_DIFFERENCES_ACTION'});
  }
  if(req.method==='POST'&&u.pathname==='/api/demo/role-based-differences/gateway-probe'){
    const b=await jsonBody(req);
    return json(res,200,await runRoleGatewayProbe(b.actorId));
  }

  if(req.method==='GET'&&u.pathname==='/api/demo/tenant-isolation')return json(res,200,tenantIsolationSummary());
  if(req.method==='GET'&&u.pathname==='/api/demo/tenant-isolation/audit')return json(res,200,{events:tenantIsolationAudit({actorId:u.searchParams.get('actorId')||null,limit:50})});
  if(req.method==='POST'&&u.pathname==='/api/demo/tenant-isolation'){const b=await jsonBody(req);if(b.action==='reset')return json(res,200,resetTenantIsolationAudit());if(b.action==='resolve')return json(res,200,resolveTenantScopedPatient({actorId:b.actorId||'endo-001',targetTenant:b.targetTenant||'helios-north',system:b.system||'hospital-mrn',value:b.value||'MRN-04217'}));return json(res,400,{error:'Unsupported tenant-isolation action',code:'INVALID_TENANT_ISOLATION_ACTION'});}
  if(req.method==='POST'&&u.pathname==='/api/demo/tenant-isolation/gateway-probe')return json(res,200,await runCrossTenantGatewayProbe());
  if(req.method==='GET'&&u.pathname==='/api/demo/encounter-lifecycle'){const encounterId=u.searchParams.get('encounterId')||'enc-501';const state=encounterLifecycleSummary(encounterId);return state?json(res,200,state):json(res,404,{error:'Encounter not found',code:'ENCOUNTER_NOT_FOUND'});}
  if(req.method==='POST'&&u.pathname==='/api/demo/encounter-lifecycle'){const b=await jsonBody(req);return json(res,200,transitionEncounterLifecycle(b));}
  if(req.method==='GET'&&u.pathname==='/api/demo/care-team-handoff'){const patientId=u.searchParams.get('patientId')||'pat-1003';const state=careTeamHandoffSummary(patientId);return state?json(res,200,state):json(res,404,{error:'Care-team handoff workflow not found',code:'CARE_HANDOFF_NOT_FOUND'});}
  if(req.method==='POST'&&u.pathname==='/api/demo/care-team-handoff'){const b=await jsonBody(req);return json(res,200,transitionCareTeamHandoff(b));}
  if(req.method==='GET'&&u.pathname==='/api/demo/purpose-of-use'){const actorId=u.searchParams.get('actorId')||'neph-001';const patientId=u.searchParams.get('patientId')||'pat-1001';const state=purposeOfUseDemoSummary({actorId,patientId});return state?json(res,200,state):json(res,404,{error:'Purpose-of-use scenario unavailable',code:'PURPOSE_OF_USE_SCENARIO_NOT_FOUND'});}
  if(req.method==='GET'&&u.pathname==='/api/demo/purpose-of-use/audit'){const actorId=u.searchParams.get('actorId')||null;const patientId=u.searchParams.get('patientId')||null;return json(res,200,{events:purposeOfUseAudit({actorId,patientId,limit:50})});}
  if(req.method==='POST'&&u.pathname==='/api/demo/purpose-of-use/reset'){const b=await jsonBody(req);resetPurposeOfUseAudit({actorId:b.actorId||null,patientId:b.patientId||null});return json(res,200,purposeOfUseDemoSummary({actorId:b.actorId||'neph-001',patientId:b.patientId||'pat-1001'}));}
  if(req.method==='GET'&&u.pathname==='/api/demo/restricted-clinical-information')return json(res,200,restrictedClinicalInformationSummary());
  if(req.method==='GET'&&u.pathname==='/api/demo/restricted-clinical-information/audit'){const actorId=u.searchParams.get('actorId')||null;const patientId=u.searchParams.get('patientId')||null;return json(res,200,{events:restrictedClinicalAudit({actorId,patientId,limit:50})});}
  if(req.method==='POST'&&u.pathname==='/api/demo/restricted-clinical-information'){const b=await jsonBody(req);if(b.action==='revoke'||b.action==='restore')return json(res,200,setRestrictedAuthorizationState(b));if(b.action==='reset')return json(res,200,resetRestrictedClinicalInformation());return json(res,400,{error:'Unsupported restricted-clinical-information action',code:'INVALID_RESTRICTED_AUTHORIZATION_ACTION'});}
  if(req.method==='GET'&&u.pathname==='/api/demo/medication-reconciliation'){const actorId=u.searchParams.get('actorId')||'neph-001';const patientId=u.searchParams.get('patientId')||'pat-1001';const state=medicationReconciliationSummary({actorId,patientId});return state?json(res,200,state):json(res,404,{error:'Medication reconciliation scenario unavailable',code:'MEDICATION_RECONCILIATION_SCENARIO_NOT_FOUND'});}
  if(req.method==='GET'&&u.pathname==='/api/demo/medication-reconciliation/audit'){const actorId=u.searchParams.get('actorId')||null;const patientId=u.searchParams.get('patientId')||null;const sessionId=u.searchParams.get('sessionId')||null;return json(res,200,{events:medicationReconciliationAudit({actorId,patientId,sessionId,limit:50})});}
  if(req.method==='POST'&&u.pathname==='/api/demo/medication-reconciliation'){const b=await jsonBody(req);if(b.action==='start')return json(res,200,await startMedicationReconciliation(b));if(b.action==='submit')return json(res,200,submitMedicationReconciliation(b));if(b.action==='reset')return json(res,200,resetMedicationReconciliation(b));return json(res,400,{error:'Unsupported medication-reconciliation action',code:'INVALID_MEDICATION_RECONCILIATION_ACTION'});}
  if(req.method==='GET'&&u.pathname==='/api/demo/graceful-abstention'){const patientId=u.searchParams.get('patientId')||'pat-1001';const state=gracefulAbstentionDemoSummary(patientId);return state?json(res,200,state):json(res,404,{error:'Graceful-abstention scenario unavailable for patient',code:'ABSTENTION_SCENARIO_NOT_FOUND'});}
  if(req.method==='GET'&&u.pathname==='/api/demo/human-approval'){const actorId=u.searchParams.get('actorId')||'neph-001';const patientId=u.searchParams.get('patientId')||'pat-1001';return json(res,200,humanApprovalSummary({actorId,patientId}));}
  if(req.method==='GET'&&u.pathname==='/api/demo/human-approval/audit'){const actorId=u.searchParams.get('actorId')||null;const patientId=u.searchParams.get('patientId')||null;const proposalId=u.searchParams.get('proposalId')||null;return json(res,200,{events:humanApprovalAudit({actorId,patientId,proposalId,limit:50})});}
  if(req.method==='POST'&&u.pathname==='/api/demo/human-approval'){const b=await jsonBody(req);if(b.action==='propose')return json(res,200,await createHumanApprovalProposal(b));if(b.action==='approve')return json(res,200,reviewHumanApprovalProposal({...b,decision:'APPROVE'}));if(b.action==='reject')return json(res,200,reviewHumanApprovalProposal({...b,decision:'REJECT'}));if(b.action==='reset')return json(res,200,resetHumanApprovalWorkflow(b));return json(res,400,{error:'Unsupported human-approval action',code:'INVALID_HUMAN_APPROVAL_ACTION'});}
  if(req.method==='GET'&&u.pathname==='/api/demo/lab-freshness'){const patientId=u.searchParams.get('patientId')||'pat-1001';const state=labFreshnessSummary(patientId);return state?json(res,200,state):json(res,404,{error:'No versioned lab-result scenario for patient',code:'LAB_FRESHNESS_SCENARIO_NOT_FOUND'});}
  if(req.method==='GET'&&u.pathname==='/api/demo/conflicting-evidence'){const patientId=u.searchParams.get('patientId')||'pat-1001';const state=clinicalEvidenceConflictSummary(patientId);return state?json(res,200,state):json(res,404,{error:'No conflicting-evidence scenario for patient',code:'CONFLICT_SCENARIO_NOT_FOUND'});}
  if(req.method==='GET'&&u.pathname==='/api/demo/break-glass'){const actorId=u.searchParams.get('actorId')||'er-001';const patientId=u.searchParams.get('patientId')||'pat-1001';return json(res,200,breakGlassSummary({actorId,patientId}));}
  if(req.method==='GET'&&u.pathname==='/api/demo/break-glass/audit'){const actorId=u.searchParams.get('actorId')||null;const patientId=u.searchParams.get('patientId')||null;return json(res,200,{events:breakGlassAudit({actorId,patientId,limit:50})});}
  if(req.method==='POST'&&u.pathname==='/api/demo/break-glass'){const b=await jsonBody(req);if(b.action==='request')return json(res,200,requestBreakGlassAccess(b));if(b.action==='verify-step-up')return json(res,200,completeBreakGlassStepUp(b));if(b.action==='revoke')return json(res,200,revokeBreakGlassAccess(b));if(b.action==='reset')return json(res,200,resetBreakGlassDemo(b));return json(res,400,{error:'Unsupported break-glass action',code:'INVALID_BREAK_GLASS_ACTION'});}
  if(req.method==='GET'&&u.pathname==='/api/traces')return json(res,200,{traces:listTraces()});
  if(req.method==='GET'&&u.pathname.startsWith('/api/traces/')){const t=getTrace(u.pathname.split('/').pop());return t?json(res,200,t):json(res,404,{error:'Trace not found'});}
  if(req.method==='GET'&&u.pathname==='/api/architecture')return json(res,200,architecture);
  if(req.method==='POST'&&u.pathname==='/api/copilot'){const b=await jsonBody(req);return json(res,200,await runCopilot({...b,app:'clinician'}));}
  if(req.method==='POST'&&u.pathname==='/api/patient-support'){const b=await jsonBody(req);return json(res,200,await runCopilot({...b,app:'patient-support'}));}
  if(req.method==='POST'&&u.pathname==='/api/demo/guardrail-probe'){const b=await jsonBody(req);return json(res,200,await runGatewayGuardrailProbe(b));}
  if(retiredFixtureRoutes.has(u.pathname)||u.pathname.startsWith('/api/scenarios/'))return json(res,410,{error:'Direct fixture access is disabled in the presentation application. Use the governed AI endpoints instead.',code:'DIRECT_FIXTURE_ACCESS_DISABLED'});
  if(u.pathname.startsWith('/api/'))return json(res,404,{error:'API route not found'});

  let path=u.pathname==='/'?'index.html':u.pathname.replace(/^\//,'');
  path=resolve(UI,path);
  if(!path.startsWith(UI))return json(res,403,{error:'Forbidden'});
  try{
    const s=await stat(path);if(s.isDirectory())path=resolve(path,'index.html');
    const data=await readFile(path);
    res.writeHead(200,{
      'content-type':mime[extname(path)]||'application/octet-stream',
      'cache-control':extname(path)==='.html'?'no-store':'public, max-age=300',
      'x-content-type-options':'nosniff',
      'content-security-policy':"default-src 'self' https://esm.sh; script-src 'self' https://esm.sh; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"
    });
    return res.end(data);
  }catch{return json(res,404,{error:'Not found'});}
}catch(err){return json(res,err.status||400,{error:err.message,code:err.code||'BAD_REQUEST'});}});
server.listen(PORT,'0.0.0.0',()=>console.log(`Helios Clinical AI Security console listening on http://localhost:${PORT}`));
