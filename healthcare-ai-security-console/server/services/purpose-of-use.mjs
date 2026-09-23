import crypto from 'node:crypto';
import { workforce, patients } from '../data/synthetic-healthcare.mjs';

export const SCHEDULING_PURPOSE='scheduling';

const CLINICAL_CHART_TOOLS=new Set([
  'get_patient_summary',
  'get_encounter',
  'get_recent_labs',
  'get_medications',
  'get_allergies',
  'get_conditions',
  'check_medication_safety',
  'draft_clinical_note',
  'request_medication_order',
  'request_test_order',
  'submit_for_clinician_approval'
]);

const CHART_QUERY_PATTERNS=[
  /\b(?:lab|labs|laboratory|potassium|creatinine|egfr|renal|kidney|a1c|glucose|sodium|hemoglobin|bnp|inr)\b/i,
  /\b(?:medication|medications|drug|dose|allerg|condition|diagnos|clinical\s+chart|chart|clinical\s+note|encounter|medical\s+history)\b/i,
  /\b(?:prescrib|order|treatment\s+plan|care\s+plan)\w*\b/i
];

const SCHEDULING_QUERY_PATTERN=/\b(?:appointment|schedule|scheduling|visit|time|date|location|clinic)\b/i;
const auditEvents=[];

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function iso(){return new Date().toISOString();}
function id(prefix){return `${prefix}-${crypto.randomUUID()}`;}

function purposeError(message,details={}){
  return Object.assign(new Error(message),{
    code:'PURPOSE_SCOPE_EXCEEDED',
    status:403,
    details
  });
}

export function recordPurposeDecision({
  context,
  operation,
  resourceCategory,
  decision,
  reasonCode=null,
  details=null
}={}){
  const patient=patients[context?.patient?.id];
  const event={
    eventId:id('purpose-audit'),
    type:'PURPOSE_OF_USE_AUTHORIZATION',
    authority:'SYSTEM',
    at:iso(),
    actorId:context?.actor?.id||null,
    actorDisplay:context?.actor?.display||null,
    actorRole:context?.actor?.role||null,
    patientPseudonym:patient?.pseudonym||context?.patient?.pseudonym||null,
    purpose:context?.purpose||null,
    operation:operation||null,
    resourceCategory:resourceCategory||null,
    decision:decision||null,
    reasonCode,
    details
  };
  auditEvents.unshift(event);
  if(auditEvents.length>250)auditEvents.length=250;
  return clone(event);
}

export function isSchedulingPurpose(purpose=''){
  return String(purpose||'').toLowerCase()===SCHEDULING_PURPOSE;
}

export function purposePolicy(purpose=''){
  if(isSchedulingPurpose(purpose)){
    return {
      purpose:SCHEDULING_PURPOSE,
      mode:'NON_CLINICAL_SCHEDULING',
      allowedTools:['get_scheduling_context'],
      permittedDataCategories:['scheduling'],
      deniedDataCategories:[
        'clinical-chart',
        'labs',
        'medications',
        'allergies',
        'conditions',
        'encounters',
        'clinical-notes',
        'orders'
      ],
      chartAccessAllowed:false,
      modelChartAccessAllowed:false
    };
  }

  return {
    purpose:String(purpose||'unspecified'),
    mode:'STANDARD_CLINICAL_PURPOSE',
    allowedTools:null,
    permittedDataCategories:null,
    deniedDataCategories:[],
    chartAccessAllowed:true,
    modelChartAccessAllowed:true
  };
}

export function allowedClinicianToolsForPurpose(context,defaultTools=[]){
  if(!isSchedulingPurpose(context?.purpose))return [...defaultTools];
  return defaultTools.includes('get_scheduling_context')
    ?['get_scheduling_context']
    :[];
}

export function assertToolAllowedForPurpose(context,toolName){
  if(context?.app!=='clinician')return true;
  if(!isSchedulingPurpose(context?.purpose))return true;

  if(toolName==='get_scheduling_context'){
    recordPurposeDecision({
      context,
      operation:toolName,
      resourceCategory:'scheduling',
      decision:'ALLOW',
      details:{
        sameRbacIdentity:true,
        purposeBound:true,
        chartReleased:false
      }
    });
    return true;
  }

  const category=
    toolName==='get_recent_labs'?'labs':
    toolName==='get_medications'?'medications':
    toolName==='get_allergies'?'allergies':
    toolName==='get_conditions'?'conditions':
    toolName==='get_encounter'?'encounters':
    CLINICAL_CHART_TOOLS.has(toolName)?'clinical-chart':'non-scheduling-capability';

  recordPurposeDecision({
    context,
    operation:toolName,
    resourceCategory:category,
    decision:'DENY',
    reasonCode:'PURPOSE_SCOPE_EXCEEDED',
    details:{
      sameRbacIdentity:true,
      requestedPurpose:context.purpose,
      permittedDataCategories:['scheduling'],
      chartReleased:false
    }
  });

  throw purposeError(
    `Purpose "${context.purpose}" does not authorize ${toolName}. The authenticated clinician identity is valid, but this interaction is restricted to scheduling data.`,
    {
      purpose:context.purpose,
      toolName,
      resourceCategory:category,
      permittedDataCategories:['scheduling']
    }
  );
}

function safeAppointment(appointment,index){
  const value=appointment&&typeof appointment==='object'?appointment:{};
  const pick=(...keys)=>{
    for(const key of keys){
      if(value[key]!==undefined&&value[key]!==null)return value[key];
    }
    return null;
  };

  return {
    appointmentRef:pick('id','appointmentId')||`synthetic-appointment-${index+1}`,
    status:pick('status')||'scheduled',
    scheduledAt:pick('scheduledAt','startsAt','start','dateTime','date','when'),
    visitType:pick('type','visitType','kind','reason'),
    service:pick('service','department','clinic','specialty'),
    location:pick('location','site')
  };
}

export function schedulingProjection(patient){
  return {
    source:'SCHEDULING',
    purpose:SCHEDULING_PURPOSE,
    categoriesReleased:['scheduling'],
    appointments:(patient?.appointments||[]).map(safeAppointment),
    chartReleased:false,
    excludedCategories:[
      'labs',
      'medications',
      'allergies',
      'conditions',
      'encounters',
      'clinical-notes'
    ]
  };
}

export function schedulingPurposePreflight({context,query=''}={}){
  if(context?.app!=='clinician'||!isSchedulingPurpose(context?.purpose)){
    return {applies:false};
  }

  const text=String(query||'');
  const asksChart=CHART_QUERY_PATTERNS.some(pattern=>pattern.test(text));

  if(asksChart){
    recordPurposeDecision({
      context,
      operation:'copilot-request',
      resourceCategory:'clinical-chart',
      decision:'DENY',
      reasonCode:'PURPOSE_SCOPE_EXCEEDED',
      details:{
        queryClass:'SCHEDULING_WITH_CLINICAL_CHART_REQUEST',
        chartReleased:false,
        modelInvoked:false
      }
    });

    return {
      applies:true,
      decision:'BLOCK',
      reasonCodes:['PURPOSE_SCOPE_EXCEEDED'],
      answer:'This authenticated clinician is operating under a scheduling purpose. Scheduling data may be used for this interaction, but the clinical chart, including laboratory results, is not authorized for this purpose.',
      authorization:{
        type:'PURPOSE_OF_USE',
        actorId:context.actor.id,
        actorRole:context.actor.role,
        purpose:context.purpose,
        decision:'DENY',
        requestedCategory:'clinical-chart',
        permittedDataCategories:['scheduling'],
        chartReleased:false
      }
    };
  }

  if(SCHEDULING_QUERY_PATTERN.test(text)){
    return {
      applies:true,
      decision:'SCHEDULING_ONLY',
      reasonCodes:[],
      authorization:{
        type:'PURPOSE_OF_USE',
        actorId:context.actor.id,
        actorRole:context.actor.role,
        purpose:context.purpose,
        decision:'ALLOW',
        permittedDataCategories:['scheduling'],
        chartReleased:false
      }
    };
  }

  return {
    applies:true,
    decision:'BLOCK',
    reasonCodes:['PURPOSE_SCOPE_EXCEEDED'],
    answer:'The scheduling purpose is restricted to scheduling metadata. This request does not match an authorized scheduling operation.',
    authorization:{
      type:'PURPOSE_OF_USE',
      actorId:context.actor.id,
      actorRole:context.actor.role,
      purpose:context.purpose,
      decision:'DENY',
      permittedDataCategories:['scheduling'],
      chartReleased:false
    }
  };
}

export function purposeOfUseAudit({
  actorId=null,
  patientId=null,
  limit=50
}={}){
  const patient=patientId?patients[patientId]:null;
  return auditEvents
    .filter(event=>
      (!actorId||event.actorId===actorId) &&
      (!patient||event.patientPseudonym===patient.pseudonym)
    )
    .slice(0,Math.max(1,Math.min(Number(limit)||50,100)))
    .map(clone);
}

export function resetPurposeOfUseAudit({
  actorId=null,
  patientId=null
}={}){
  const patient=patientId?patients[patientId]:null;
  for(let i=auditEvents.length-1;i>=0;i--){
    if(
      (!actorId||auditEvents[i].actorId===actorId) &&
      (!patient||auditEvents[i].patientPseudonym===patient.pseudonym)
    ){
      auditEvents.splice(i,1);
    }
  }
}

export function purposeOfUseDemoSummary({
  actorId='neph-001',
  patientId='pat-1001'
}={}){
  const actor=workforce[actorId];
  const patient=patients[patientId];
  if(!actor||!patient)return null;

  const baseScopes=[...(actor.scopes||[])];

  return {
    actor:{
      id:actor.id,
      display:actor.display,
      role:actor.role,
      specialty:actor.specialty||null,
      baseScopes
    },
    patient:{
      display:patient.name,
      pseudonym:patient.pseudonym
    },
    comparison:{
      sameIdentity:true,
      sameRole:true,
      sameBaseScopes:true,
      treatment:{
        purpose:'lab-review',
        requestedCategory:'labs',
        expectedDecision:'ALLOW',
        tool:'get_recent_labs',
        gatewayPath:true
      },
      scheduling:{
        purpose:SCHEDULING_PURPOSE,
        requestedCategory:'scheduling',
        expectedDecision:'ALLOW',
        tool:'get_scheduling_context',
        gatewayPath:false,
        chartReleased:false
      },
      schedulingChartAttempt:{
        purpose:SCHEDULING_PURPOSE,
        requestedCategory:'labs',
        expectedDecision:'DENY',
        reasonCode:'PURPOSE_SCOPE_EXCEEDED',
        gatewayPath:false,
        modelInvoked:false,
        chartReleased:false
      }
    },
    schedulingPolicy:purposePolicy(SCHEDULING_PURPOSE),
    audit:purposeOfUseAudit({actorId,patientId,limit:20}),
    principle:'Authorization is evaluated from identity plus patient relationship plus purpose of use; RBAC alone is not sufficient.'
  };
}
