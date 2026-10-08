import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const CLINICAL=fileURLToPath(new URL('../../../modular-ai-guardrails/config/clinical-policy-chain.json',import.meta.url));
const PATIENT=fileURLToPath(new URL('../../../modular-ai-guardrails/config/patient-support-policy-chain.json',import.meta.url));
const nativeNames=new Set(['api-key-auth','regex-guardrail','llm-cost-based-ratelimit','llm-cost','request-rewrite']);
function load(path){return JSON.parse(readFileSync(path,'utf8'))}
function extra(id){
  if(id==='regex-guardrail')return {
    id,category:'Data protection',title:'Argentina DNI / CUIL-CUIT syntactic DLP',
    scenario:'A synthetic Argentine identifier is placed in a model-bound prompt. The WSO2-native Regex Guardrail rejects the syntax before provider processing.',
    example:'Synthetic demo only: “DNI 32.456.789” / “CUIL 27-32456789-4”. No identity or checksum validation is claimed.',
    expected:'WSO2 native Regex Guardrail intervention before the provider.',
    business:'Adds an Argentina-specific deterministic DLP control without replacing the broader Helios healthcare PHI policy.',
    mode:'live',page:'Guardrails',app:'clinician',prompt:'Paciente sintético de demostración — DNI 32.456.789'
  };
  if(id==='llm-cost-based-ratelimit')return {
    id,category:'AI economics',title:'Native application cost budget',
    scenario:'Clinician AI and Patient AI have separate deliberately small 24-hour spending budgets enforced by WSO2 AI Gateway.',
    example:'Clinician AI: USD 0.05 / 24h · Patient AI: USD 0.02 / 24h.',
    expected:'WSO2 tracks route spend and rejects subsequent requests with HTTP 429 after the configured budget is exhausted.',
    business:"We don't only make clinical AI safer; we make its consumption governable.",
    mode:'walkthrough',page:'Executive Observability'
  };
  if(id==='llm-cost')return {
    id,category:'AI economics',title:'Native LLM cost accounting',
    scenario:'WSO2 calculates operational LLM cost from provider token usage and its pricing database so cost budgets can be enforced.',
    example:'The executive view distinguishes Gateway-accounted or estimated operational consumption from provider invoicing.',
    expected:'Cost metadata feeds the native WSO2 cost-based rate-limit policy.',
    business:'Connects model usage to enforceable platform economics.',mode:'walkthrough',page:'Executive Observability'
  };
  return {id,category:'Gateway',title:id,scenario:'Gateway stage.',example:id,expected:'Stage executes according to its configured phase.',business:'Governed AI runtime.',mode:'walkthrough'};
}
export function augmentP1DemoCatalog(base){
  const c=load(CLINICAL),p=load(PATIENT),cn=c.map(x=>x.name),pn=p.map(x=>x.name);
  if(JSON.stringify(cn)!==JSON.stringify(pn))throw new Error('Clinical and patient policy stage ordering differs.');
  const byId=new Map((base.policyScenarios||[]).map(x=>[x.id,x]));
  const policyScenarios=cn.map((id,i)=>({...((byId.get(id))||extra(id)),sequence:i+1,provenance:nativeNames.has(id)?'WSO2 Native':'Helios Domain Policy'}));
  const wso2Native=policyScenarios.filter(x=>x.provenance==='WSO2 Native').length;
  const heliosDomainPolicy=policyScenarios.filter(x=>x.provenance==='Helios Domain Policy').length;
  return {...base,summary:{...(base.summary||{}),policyStages:policyScenarios.length},policyScenarios,
    policyProvenance:{gatewayStages:policyScenarios.length,wso2Native,heliosDomainPolicy,
      applicationAuthority:{separate:true,label:'Application Authority',note:'Application Authority is not counted as a Gateway policy stage.'}}};
}
