const obj=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const s=(description)=>({type:'string',description});
const n=(description)=>({type:'number',description});

const clinician={
  get_patient_summary:{description:'Retrieve a purpose-minimized authoritative summary for the server-bound patient and encounter. Never use a patient identifier from conversation text.',parameters:obj({})},
  get_encounter:{description:'Retrieve the authoritative encounter bound by the server context.',parameters:obj({})},
  get_recent_labs:{description:'Retrieve recent authoritative synthetic lab observations for the server-bound patient. Use this before stating a lab value.',parameters:obj({})},
  get_medications:{description:'Retrieve authoritative current synthetic medication records for the server-bound patient.',parameters:obj({})},
  get_allergies:{description:'Retrieve authoritative synthetic allergy records for the server-bound patient.',parameters:obj({})},
  get_conditions:{description:'Retrieve authoritative synthetic condition records for the server-bound patient.',parameters:obj({})},
  get_restricted_clinical_information:{description:'Retrieve a separately protected behavioral-health clinical segment for the server-bound patient. This requires an active care relationship, the restricted behavioral-health scope, an active patient authorization, and the behavioral-health-treatment purpose. Ordinary chart access is insufficient.',parameters:obj({})},
  search_clinical_knowledge:{description:'Search tenant-scoped trusted/versioned clinical knowledge. Uploaded or referral evidence is not automatically authority.',parameters:obj({query:s('Clinical knowledge question or topic.')},['query'])},
  check_medication_safety:{description:'Run the deterministic DEMO safety fixture. This is not a medical knowledge engine.',parameters:obj({medication:s('Synthetic medication code, for example SYNTH-MED-A.'),dose:n('Synthetic demo dose.'),unit:s('Synthetic dose unit if provided.')},['medication','dose'])},
  draft_clinical_note:{description:'Create a non-authoritative draft note from a purpose-minimized server-side view. It always requires clinician review.',parameters:obj({})},
  request_medication_order:{description:'Create an approval-bound medication-order REQUEST only. This does not place an order.',parameters:obj({medication:s('Synthetic medication code.'),dose:n('Synthetic demo dose.'),unit:s('Synthetic dose unit.')},['medication','dose'])},
  request_test_order:{description:'Create an approval-bound test-order REQUEST only. This does not place an order.',parameters:obj({test:s('Synthetic test code or name.'),reason:s('Reason for requesting the synthetic test.')},['test','reason'])},
  submit_for_clinician_approval:{description:'Submit an existing synthetic action request for bound clinician approval. A valid external approval token is required; never invent or forge it.',parameters:obj({requestId:s('Existing action request ID.'),approvalToken:s('Externally supplied clinician approval token.')},['requestId','approvalToken'])}
};

const patient={
  get_own_appointment:{description:'Retrieve only the authenticated patient portal user\'s own synthetic appointment data.',parameters:obj({})},
  get_own_approved_instructions:{description:'Retrieve only clinician-approved patient instructions for the authenticated patient.',parameters:obj({})},
  search_patient_education:{description:'Search only approved patient-education knowledge for this tenant.',parameters:obj({query:s('Patient education topic.')},['query'])},
  request_callback:{description:'Queue a non-clinical synthetic callback request. It cannot access the clinical chart.',parameters:obj({})}
};

function asOpenAITools(defs){return Object.entries(defs).map(([name,d])=>({type:'function',function:{name,description:d.description,parameters:d.parameters}}));}
export const clinicianToolSchemas=asOpenAITools(clinician);
export const patientToolSchemas=asOpenAITools(patient);
export function schemasForApp(app){return app==='patient-support'?patientToolSchemas:clinicianToolSchemas;}
