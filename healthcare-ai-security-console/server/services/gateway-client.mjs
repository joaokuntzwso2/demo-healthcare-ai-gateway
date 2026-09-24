import https from 'node:https';
import crypto from 'node:crypto';

const MODE=()=>process.env.LLM_MODE||'deterministic';
const BASE=()=>process.env.WSO2_AI_GATEWAY_URL||'https://localhost:18443';
const CLINICAL_KEY=()=>process.env.WSO2_CLINICAL_PROXY_API_KEY||process.env.WSO2_AI_GATEWAY_API_KEY||'';
const PATIENT_KEY=()=>process.env.WSO2_PATIENT_PROXY_API_KEY||process.env.WSO2_AI_GATEWAY_API_KEY||'';
const CLINICAL_CONTEXT=()=>process.env.WSO2_CLINICAL_PROXY_CONTEXT||'/default/clinical-ai-secure';
const PATIENT_CONTEXT=()=>process.env.WSO2_PATIENT_PROXY_CONTEXT||'/default/patient-support-ai-secure';
const API_KEY_HEADER=()=>process.env.WSO2_API_KEY_HEADER||'X-API-Key';
const DEFAULT_MODEL=()=>process.env.WSO2_DEFAULT_MODEL||process.env.OPENAI_MODEL||'gpt-4o-mini';

export function gatewayConfig(){
  return {
    mode:MODE(),
    baseUrl:BASE(),
    provider:process.env.WSO2_PROVIDER_ID||'helios-enterprise-openai',
    clinicianProxy:'clinical-ai-secure',
    patientProxy:'patient-support-ai-secure',
    clinicianContext:CLINICAL_CONTEXT(),
    patientContext:PATIENT_CONTEXT(),
    apiKeyHeader:API_KEY_HEADER(),
    model:DEFAULT_MODEL(),
    separateApplicationKeys:Boolean(process.env.WSO2_CLINICAL_PROXY_API_KEY&&process.env.WSO2_PATIENT_PROXY_API_KEY),
    endToEnd:MODE()==='gateway'
  };
}

function requestJson(url,body,headers={}){
  return new Promise((resolve,reject)=>{
    const u=new URL(url);
    const data=JSON.stringify(body);
    const req=https.request({
      hostname:u.hostname,
      port:u.port||443,
      path:`${u.pathname}${u.search}`,
      method:'POST',
      rejectUnauthorized:process.env.WSO2_TLS_INSECURE!=='true',
      headers:{'content-type':'application/json','content-length':Buffer.byteLength(data),...headers}
    },res=>{
      let d='';
      res.on('data',c=>d+=c);
      res.on('end',()=>{
        let parsed;
        try{parsed=JSON.parse(d)}catch{parsed={raw:d}}
        resolve({status:res.statusCode,body:parsed,headers:res.headers});
      });
    });
    req.on('error',reject);
    req.write(data);
    req.end();
  });
}

function signedHeliosContextHeaders(context){
  const heliosContext={
    tenant:context.tenant,
    actor:context.actor.id,
    role:context.actor.role,
    patientId:context.patient.id,
    patientPseudonym:context.patient.pseudonym,
    encounter:context.encounter,
    purpose:context.purpose,
    scopes:context.scopes,
    app:context.app,
    breakGlass:context.breakGlass?{active:context.breakGlass.active,mode:context.breakGlass.mode,grantId:context.breakGlass.grantId,stepUpMethod:context.breakGlass.stepUpMethod,expiresAt:context.breakGlass.expiresAt,severity:context.breakGlass.severity}:null,
    careRelationship:context.careRelationship?{phaseId:context.careRelationship.phaseId,careSetting:context.careRelationship.careSetting,service:context.careRelationship.service,currentOwnerActorId:context.careRelationship.currentOwnerActorId,active:context.careRelationship.active,relationshipVersion:context.careRelationship.relationshipVersion}:null,
    restrictedAuthorization:context.restrictedAuthorization?{type:context.restrictedAuthorization.type,category:context.restrictedAuthorization.category,requiredScope:context.restrictedAuthorization.requiredScope,requiredPurpose:context.restrictedAuthorization.requiredPurpose,purpose:context.restrictedAuthorization.purpose,careRelationship:context.restrictedAuthorization.careRelationship,scopePresent:context.restrictedAuthorization.scopePresent,patientAuthorizationPresent:context.restrictedAuthorization.patientAuthorizationPresent,purposeAuthorized:context.restrictedAuthorization.purposeAuthorized,active:context.restrictedAuthorization.active,authorizationId:context.restrictedAuthorization.authorizationId,expiresAt:context.restrictedAuthorization.expiresAt}:null
  };
  const encoded=Buffer.from(JSON.stringify(heliosContext),'utf8').toString('base64url');
  const signingKey=process.env.HELIOS_CONTEXT_SIGNING_KEY;
  if(!signingKey) throw new Error('HELIOS_CONTEXT_SIGNING_KEY is required in gateway mode.');
  const signature=crypto.createHmac('sha256',signingKey).update(encoded).digest('hex');
  return {'X-Helios-Clinical-Context':encoded,'X-Helios-Clinical-Signature':signature};
}

export async function invokeModel({context,messages,model=DEFAULT_MODEL(),maxTokens=700,tools,toolChoice,temperature=0}){
  if(MODE()==='deterministic') return {
    mode:'deterministic',model:'helios-deterministic-renderer',status:200,
    content:'DETERMINISTIC_DEMO_RENDERER',message:{role:'assistant',content:'DETERMINISTIC_DEMO_RENDERER'},raw:null
  };

  const clinician=context.app==='clinician';
  const proxy=clinician?'clinical-ai-secure':'patient-support-ai-secure';
  const proxyContext=clinician?CLINICAL_CONTEXT():PATIENT_CONTEXT();
  const apiKey=clinician?CLINICAL_KEY():PATIENT_KEY();
  if(!apiKey) throw new Error(`Missing API key for ${proxy}. Set WSO2_${clinician?'CLINICAL':'PATIENT'}_PROXY_API_KEY.`);

  const url=`${BASE().replace(/\/$/,'')}${proxyContext}/chat/completions`;
  const body={model,messages,max_tokens:maxTokens,temperature};
  if(Array.isArray(tools)&&tools.length){body.tools=tools;body.tool_choice=toolChoice||'auto';}

  const resp=await requestJson(url,body,{[API_KEY_HEADER()]:apiKey,...signedHeliosContextHeaders(context)});
  const message=resp.body?.choices?.[0]?.message||null;
  if(resp.status>=400) return {mode:'gateway',proxy,url,model,status:resp.status,error:resp.body,raw:resp.body,message:null,content:''};
  return {mode:'gateway',proxy,url,model,status:resp.status,message,content:message?.content??'',raw:resp.body};
}
