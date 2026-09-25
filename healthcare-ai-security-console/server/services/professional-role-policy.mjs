export const PROFESSIONAL_ROLE_POLICY='PROFESSIONAL_ROLE_LEAST_PRIVILEGE';
export const PROFESSIONAL_ROLE_POLICY_VERSION='professional-role-v1';

const ALL_PHYSICIAN_TOOLS=[
  'get_patient_summary','get_encounter','get_recent_labs','get_medications',
  'get_allergies','get_conditions','search_clinical_knowledge',
  'check_medication_safety','draft_clinical_note','request_medication_order',
  'request_test_order','submit_for_clinician_approval','get_scheduling_context',
  'get_restricted_clinical_information'
];

const PROFILE_DEFS={
  physician:{
    id:'physician',label:'Physician',
    responsibility:'Broad clinical review with request-level action authority; execution and final approval remain outside the model.',
    tools:ALL_PHYSICIAN_TOOLS,
    capabilityDomains:['clinical-summary','encounters','labs','medications','allergies','conditions','clinical-knowledge','medication-safety','note-drafting','clinical-action-request','clinician-approval'],
    actionAuthority:'MAY_CREATE_APPROVAL_BOUND_REQUESTS'
  },
  pharmacist:{
    id:'pharmacist',label:'Clinical pharmacist',
    responsibility:'Medication, allergy, laboratory and medication-safety review without prescribing/order authority.',
    tools:['get_recent_labs','get_medications','get_allergies','get_conditions','search_clinical_knowledge','check_medication_safety'],
    capabilityDomains:['labs','medications','allergies','conditions','clinical-knowledge','medication-safety'],
    actionAuthority:'READ_AND_SAFETY_REVIEW_ONLY'
  },
  nurse:{
    id:'nurse',label:'Registered nurse',
    responsibility:'Care-context, laboratory and allergy review plus draft documentation; no medication/order authority.',
    tools:['get_patient_summary','get_encounter','get_recent_labs','get_allergies','search_clinical_knowledge','draft_clinical_note','get_scheduling_context'],
    capabilityDomains:['clinical-summary','encounters','labs','allergies','clinical-knowledge','note-drafting','scheduling'],
    actionAuthority:'NO_CLINICAL_ORDER_AUTHORITY'
  },
  'behavioral-health':{
    id:'behavioral-health',
    label:'Behavioral-health clinician',
    responsibility:'Behavioral-health clinical review with explicitly authorized restricted-record access; no authority is inferred from scope alone.',
    tools:[
      'get_patient_summary',
      'get_encounter',
      'get_allergies',
      'search_clinical_knowledge',
      'draft_clinical_note',
      'get_restricted_clinical_information'
    ],
    capabilityDomains:[
      'clinical-summary',
      'encounters',
      'allergies',
      'clinical-knowledge',
      'note-drafting',
      'restricted-behavioral-health'
    ],
    actionAuthority:'SPECIALTY_CLINICAL_REVIEW_ONLY'
  },
  'care-manager':{
    id:'care-manager',label:'Care manager',
    responsibility:'Care-transition summary, trusted knowledge, draft coordination documentation and scheduling; no detailed medication/lab or order authority.',
    tools:['get_patient_summary','get_encounter','search_clinical_knowledge','draft_clinical_note','get_scheduling_context'],
    capabilityDomains:['clinical-summary','encounters','clinical-knowledge','note-drafting','scheduling'],
    actionAuthority:'CARE_COORDINATION_ONLY'
  },
  unrecognized:{
    id:'unrecognized',label:'Unrecognized professional role',
    responsibility:'No clinical AI tools are granted until a professional-role policy is defined.',
    tools:[],capabilityDomains:[],actionAuthority:'DENY_BY_DEFAULT'
  }
};

const TOOL_SCOPE={
  get_patient_summary:'chart:summary',
  get_encounter:'chart:summary',
  get_recent_labs:'labs:read',
  get_medications:'medications:read',
  get_allergies:'allergies:read',
  get_conditions:'conditions:read',
  search_clinical_knowledge:'knowledge:read',
  check_medication_safety:'medication-safety:read',
  draft_clinical_note:'note:draft',
  request_medication_order:'clinical-action:request',
  request_test_order:'clinical-action:request',
  submit_for_clinician_approval:'approval:submit',
  get_restricted_clinical_information:'restricted:behavioral-health:read'
};

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}

export function professionalRoleFamily(role=''){
  const r=String(role||'').trim().toLowerCase();
  if(r.includes('behavioral-health')){
    if(r.includes('physician'))return'physician';
    return'behavioral-health';
  }
  if(r==='hospitalist'||r.includes('physician'))return'physician';
  if(r.includes('pharmacist'))return'pharmacist';
  if(r.includes('nurse')&&!r.includes('care-manager'))return'nurse';
  if(r==='care-manager'||r.includes('care manager'))return'care-manager';
  return'unrecognized';
}

export function professionalRoleContext(actor={}){
  const family=professionalRoleFamily(actor.role);
  const def=PROFILE_DEFS[family]||PROFILE_DEFS.unrecognized;
  return {family:def.id,label:def.label,policy:PROFESSIONAL_ROLE_POLICY,version:PROFESSIONAL_ROLE_POLICY_VERSION,actionAuthority:def.actionAuthority};
}

export function requiredScopeForTool(toolName){return TOOL_SCOPE[toolName]||null;}

export function roleAllowedTools(context,candidateTools=[]){
  if(context?.app!=='clinician')return[];
  const family=professionalRoleFamily(context?.actor?.role);
  const def=PROFILE_DEFS[family]||PROFILE_DEFS.unrecognized;
  const roleSet=new Set(def.tools);
  const scopes=new Set(context?.scopes||[]);
  const scheduling=String(context?.purpose||'').toLowerCase()==='scheduling';
  return [...candidateTools].filter(tool=>{
    /*
     * Restricted clinical information is governed by the dedicated
     * restricted-record authorization layer. If this tool appears in
     * candidateTools, baseAllowedTools() has already confirmed the
     * active restricted authorization for this actor/patient/purpose.
     *
     * The professional-role layer therefore preserves it, while still
     * requiring the explicit restricted scope. Scope alone is not
     * sufficient system-wide because assertRestrictedClinicalAccess()
     * and the WSO2 sensitive-clinical-context guard independently
     * enforce the dedicated authorization.
     */
    if(tool==='get_restricted_clinical_information'){
      return scopes.has('restricted:behavioral-health:read');
    }

    if(!roleSet.has(tool))return false;
    if(tool==='get_scheduling_context'&&!scheduling)return false;

    const required=requiredScopeForTool(tool);
    if(required&&!scopes.has(required))return false;

    return true;
  });
}

export function professionalRolePolicyForContext(context,candidateTools=[]){
  const family=professionalRoleFamily(context?.actor?.role);
  const def=PROFILE_DEFS[family]||PROFILE_DEFS.unrecognized;
  const allowed=roleAllowedTools(context,candidateTools);
  const allowedSet=new Set(allowed);
  return clone({
    policy:PROFESSIONAL_ROLE_POLICY,version:PROFESSIONAL_ROLE_POLICY_VERSION,
    family:def.id,label:def.label,responsibility:def.responsibility,
    actionAuthority:def.actionAuthority,capabilityDomains:def.capabilityDomains,
    allowedTools:allowed,deniedTools:[...candidateTools].filter(x=>!allowedSet.has(x)),
    signedScopes:[...(context?.scopes||[])]
  });
}

export function assertProfessionalToolAllowed(context,toolName,candidateTools=[]){
  if(context?.app!=='clinician')return true;
  const candidates=candidateTools.length?candidateTools:[toolName];
  if(new Set(roleAllowedTools(context,candidates)).has(toolName))return true;
  const family=professionalRoleFamily(context?.actor?.role);
  const requiredScope=requiredScopeForTool(toolName);
  throw Object.assign(new Error(`Professional role ${family} is not authorized to use ${toolName}.`),{
    code:'PROFESSIONAL_ROLE_CAPABILITY_DENIED',status:403,
    details:{policy:PROFESSIONAL_ROLE_POLICY,version:PROFESSIONAL_ROLE_POLICY_VERSION,professionalRole:family,actorRole:context?.actor?.role||null,toolName,requiredScope,hasRequiredScope:requiredScope?Boolean((context?.scopes||[]).includes(requiredScope)):null}
  });
}

export function assertProfessionalActionAuthority(context,actionName){
  if(context?.app!=='clinician'){
    throw Object.assign(new Error('Clinical action authority is available only in the clinician application context.'),{code:'CLINICAL_DATA_NOT_AUTHORIZED',status:403});
  }
  const family=professionalRoleFamily(context?.actor?.role);
  if(family!=='physician'){
    throw Object.assign(new Error(`${family} does not have physician clinical-action authority in this demonstration.`),{
      code:'PROFESSIONAL_ROLE_CAPABILITY_DENIED',status:403,
      details:{policy:PROFESSIONAL_ROLE_POLICY,professionalRole:family,actionName}
    });
  }
  const scope=actionName==='submit_for_clinician_approval'?'approval:submit':'clinical-action:request';
  if(!(context?.scopes||[]).includes(scope)){
    throw Object.assign(new Error(`Scope ${scope} is required for ${actionName}.`),{code:'CLINICAL_DATA_NOT_AUTHORIZED',status:403});
  }
  return true;
}

export function roleSystemInstruction(context){
  const family=professionalRoleFamily(context?.actor?.role);
  const def=PROFILE_DEFS[family]||PROFILE_DEFS.unrecognized;
  return `Professional responsibility boundary: ${def.label}. ${def.responsibility} Only the tools provided for this turn are authorized. Never claim, simulate, or recommend exercising a capability that is absent from the provided tool set.`;
}

export function professionalRoleDefinitions(){return clone(PROFILE_DEFS);}
