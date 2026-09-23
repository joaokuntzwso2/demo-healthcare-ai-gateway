export const organizations = {
  'helios-north': { id: 'helios-north', name: 'Helios North Teaching Hospital', jurisdiction: 'US', type: 'academic-medical-center' },
  'helios-west': { id: 'helios-west', name: 'Helios West Community Network', jurisdiction: 'US', type: 'integrated-delivery-network' },
  'aurora-br': { id: 'aurora-br', name: 'Aurora Saúde Integrada', jurisdiction: 'BR', type: 'integrated-care' }
};

const physicianScopes=['chart:summary','labs:read','medications:read','allergies:read','conditions:read','knowledge:read','note:draft','clinical-action:request','approval:submit','medication-safety:read'];

export const workforce = {
  'clin-001': { id:'clin-001',tenant:'helios-north',display:'Dr. Avery Morgan',role:'attending-physician',specialty:'Internal Medicine',scopes:[...physicianScopes] },
  'neph-001': { id:'neph-001',tenant:'helios-north',display:'Dr. Priya Nair',role:'attending-physician',specialty:'Nephrology',scopes:[...physicianScopes,'approval:submit'] },
  'cardio-001': { id:'cardio-001',tenant:'helios-north',display:'Dr. Lena Brooks',role:'attending-physician',specialty:'Cardiology',scopes:[...physicianScopes] },
  'endo-001': { id:'endo-001',tenant:'helios-north',display:'Dr. Mateo Ruiz',role:'attending-physician',specialty:'Endocrinology',scopes:[...physicianScopes] },
  'hosp-001': { id:'hosp-001',tenant:'helios-north',display:'Dr. Ethan Kim',role:'hospitalist',specialty:'Hospital Medicine',scopes:[...physicianScopes] },
  'pulm-001': { id:'pulm-001',tenant:'helios-north',display:'Dr. Nora Williams',role:'attending-physician',specialty:'Pulmonology',scopes:[...physicianScopes] },
  'pharm-001': { id:'pharm-001',tenant:'helios-north',display:'Morgan Lee, PharmD',role:'clinical-pharmacist',specialty:'Clinical Pharmacy',scopes:['medications:read','allergies:read','labs:read','conditions:read','knowledge:read','medication-safety:read'] },
  'nurse-001': { id:'nurse-001',tenant:'helios-north',display:'Jordan Chen, RN',role:'registered-nurse',specialty:'Ambulatory Care',scopes:['chart:summary','labs:read','allergies:read','knowledge:read','note:draft'] },
  'care-001': { id:'care-001',tenant:'helios-north',display:'Sofia Bennett, RN',role:'care-manager',specialty:'Transitions of Care',scopes:['chart:summary','knowledge:read','note:draft'] },
  'west-001': { id:'west-001',tenant:'helios-west',display:'Dr. Maya Patel',role:'attending-physician',specialty:'Family Medicine',scopes:[...physicianScopes] },
  'clin-br-001': { id:'clin-br-001',tenant:'aurora-br',display:'Dra. Marina Silva',role:'attending-physician',specialty:'Clínica Médica',scopes:[...physicianScopes] },
  'cardio-br-001': { id:'cardio-br-001',tenant:'aurora-br',display:'Dr. Rafael Almeida',role:'attending-physician',specialty:'Cardiologia',scopes:[...physicianScopes] },
  'pharm-br-001': { id:'pharm-br-001',tenant:'aurora-br',display:'Camila Rocha, Farm.',role:'clinical-pharmacist',specialty:'Farmácia Clínica',scopes:['medications:read','allergies:read','labs:read','conditions:read','knowledge:read','medication-safety:read'] }
};

export const careAssignments = {
  'clin-001': ['pat-1001','pat-1006'],
  'neph-001': ['pat-1001'],
  'cardio-001': ['pat-1003'],
  'endo-001': ['pat-1004'],
  'hosp-001': ['pat-1006','pat-1007'],
  'pulm-001': ['pat-1002'],
  'pharm-001': ['pat-1005'],
  'nurse-001': ['pat-1001','pat-1003'],
  'care-001': ['pat-1007'],
  'west-001': ['pat-west-3001'],
  'clin-br-001': ['pat-br-2001'],
  'cardio-br-001': ['pat-br-2002'],
  'pharm-br-001': ['pat-br-2001']
};

export function isClinicianAssignedToPatient(actorId, patientId){
  return (careAssignments[actorId] || []).includes(patientId);
}

export const patients = {
  'pat-1001': {
    id:'pat-1001',tenant:'helios-north',pseudonym:'HN-P-7F21A8',name:'Marcus Reed',birthYear:1958,
    conditions:[
      {id:'cond-1',code:'I10',display:'Hypertension',status:'active',source:'EHR-CONDITIONS'},
      {id:'cond-2',code:'N18.32',display:'Chronic kidney disease, stage 3b',status:'active',source:'EHR-CONDITIONS'}
    ],
    medications:[
      {id:'med-1',code:'SYNTH-MED-A',display:'Synthetic ACE-inhibitor fixture',dose:'10 demo-units daily',status:'active',source:'EHR-MEDICATIONS'},
      {id:'med-2',code:'SYNTH-MED-ANTICOAG',display:'Synthetic potassium-sparing fixture',dose:'25 demo-units daily',status:'active',source:'EHR-MEDICATIONS'}
    ],
    allergies:[{id:'alg-1',code:'SYNTH-CLASS-BETA',display:'Synthetic beta-class medication allergy',criticality:'high',source:'EHR-ALLERGIES'}],
    labs:[
      {id:'lab-k-20260916',code:'SYNTH-K',display:'Potassium',value:5.8,unit:'mmol/L',observedAt:'2026-09-16T09:20:00Z',flag:'high-demo',source:'LAB-SYSTEM'},
      {id:'lab-cr-20260916',code:'SYNTH-CREAT',display:'Creatinine',value:2.1,unit:'mg/dL',observedAt:'2026-09-16T09:20:00Z',flag:'high-demo',source:'LAB-SYSTEM'},
      {id:'lab-egfr-20260916',code:'SYNTH-EGFR',display:'Estimated GFR',value:34,unit:'mL/min/1.73m2',observedAt:'2026-09-16T09:20:00Z',flag:'low-demo',source:'LAB-SYSTEM'},
      {id:'lab-k-20260612',code:'SYNTH-K',display:'Potassium',value:4.9,unit:'mmol/L',observedAt:'2026-06-12T08:40:00Z',flag:'normal-demo',source:'LAB-SYSTEM'},
      {id:'lab-cr-20260612',code:'SYNTH-CREAT',display:'Creatinine',value:1.7,unit:'mg/dL',observedAt:'2026-06-12T08:40:00Z',flag:'high-demo',source:'LAB-SYSTEM'}
    ],
    encounters:[{id:'enc-501',type:'outpatient',start:'2026-09-16T09:00:00Z',reason:'Renal and medication review after abnormal chemistry panel',clinician:'neph-001',source:'EHR-ENCOUNTERS'}],
    notes:[{id:'note-1',encounter:'enc-501',text:'Synthetic note: follow-up after chemistry results; medication reconciliation pending clinician review.',author:'neph-001',source:'EHR-NOTES'}],
    referrals:[{id:'ref-safe-1',encounter:'enc-501',sourceType:'external-referral',text:'Synthetic referral: review renal function and current medication list.',authority:'untrusted-evidence'}],
    carePlans:[{id:'cp-1',status:'active',text:'Synthetic follow-up plan for renal and medication review.',source:'EHR-CAREPLAN'}],
    appointments:[{id:'apt-1',date:'2026-10-04T14:00:00Z',clinic:'Helios Nephrology Clinic',status:'booked'}],
    approvedInstructions:[{id:'inst-1',text:'Bring an updated medication list and complete the ordered laboratory work before the next visit.',approvedBy:'neph-001'}]
  },
  'pat-1002': {
    id:'pat-1002',tenant:'helios-north',pseudonym:'HN-P-2C90D1',name:'Elena Torres',birthYear:1988,
    conditions:[{id:'cond-b1',code:'J45.40',display:'Persistent asthma',status:'active',source:'EHR-CONDITIONS'}],
    medications:[{id:'med-b1',code:'SYNTH-INHALER-A',display:'Synthetic controller inhaler fixture',dose:'2 demo-inhalations daily',status:'active',source:'EHR-MEDICATIONS'}],
    allergies:[],
    labs:[
      {id:'lab-eos-1',code:'SYNTH-EOS',display:'Eosinophils',value:420,unit:'cells/uL',observedAt:'2026-09-14T13:10:00Z',flag:'review-demo',source:'LAB-SYSTEM'},
      {id:'lab-wbc-b1',code:'SYNTH-WBC',display:'White blood cell count',value:7.4,unit:'10^3/uL',observedAt:'2026-09-14T13:10:00Z',flag:'normal-demo',source:'LAB-SYSTEM'}
    ],
    encounters:[{id:'enc-502',type:'telehealth',start:'2026-09-14T15:00:00Z',reason:'Respiratory symptom follow-up',clinician:'pulm-001',source:'EHR-ENCOUNTERS'}],
    notes:[],referrals:[],carePlans:[{id:'cp-b1',status:'active',text:'Synthetic respiratory follow-up plan.',source:'EHR-CAREPLAN'}],
    appointments:[{id:'apt-b1',date:'2026-10-12T16:30:00Z',clinic:'Helios Respiratory Clinic',status:'booked'}],
    approvedInstructions:[{id:'inst-b1',text:'Bring your inhaler list and symptom diary to the next respiratory visit.',approvedBy:'pulm-001'}]
  },
  'pat-1003': {
    id:'pat-1003',tenant:'helios-north',pseudonym:'HN-P-4D62B3',name:'George Campbell',birthYear:1949,
    conditions:[{id:'cond-c1',code:'I50.32',display:'Chronic heart failure',status:'active',source:'EHR-CONDITIONS'}],
    medications:[{id:'med-c1',code:'SYNTH-HF-A',display:'Synthetic heart-failure medication fixture',dose:'1 demo-tablet daily',status:'active',source:'EHR-MEDICATIONS'}],
    allergies:[],
    labs:[
      {id:'lab-bnp-c1',code:'SYNTH-BNP',display:'BNP',value:780,unit:'pg/mL',observedAt:'2026-09-18T07:30:00Z',flag:'high-demo',source:'LAB-SYSTEM'},
      {id:'lab-na-c1',code:'SYNTH-NA',display:'Sodium',value:132,unit:'mmol/L',observedAt:'2026-09-18T07:30:00Z',flag:'low-demo',source:'LAB-SYSTEM'},
      {id:'lab-cr-c1',code:'SYNTH-CREAT',display:'Creatinine',value:1.5,unit:'mg/dL',observedAt:'2026-09-18T07:30:00Z',flag:'review-demo',source:'LAB-SYSTEM'}
    ],
    encounters:[{id:'enc-503',type:'outpatient',start:'2026-09-18T08:30:00Z',reason:'Heart-failure post-discharge review',clinician:'cardio-001',source:'EHR-ENCOUNTERS'}],
    notes:[],referrals:[],carePlans:[{id:'cp-c1',status:'active',text:'Synthetic post-discharge cardiology follow-up.',source:'EHR-CAREPLAN'}],
    appointments:[{id:'apt-c1',date:'2026-09-29T15:00:00Z',clinic:'Helios Heart Failure Clinic',status:'booked'}],
    approvedInstructions:[{id:'inst-c1',text:'Follow the approved discharge instructions and bring your medication list to follow-up.',approvedBy:'cardio-001'}]
  },
  'pat-1004': {
    id:'pat-1004',tenant:'helios-north',pseudonym:'HN-P-8A31F4',name:'Nadia Rahman',birthYear:1972,
    conditions:[{id:'cond-d1',code:'E11.9',display:'Type 2 diabetes',status:'active',source:'EHR-CONDITIONS'}],
    medications:[{id:'med-d1',code:'SYNTH-DM-A',display:'Synthetic diabetes medication fixture',dose:'1 demo-tablet twice daily',status:'active',source:'EHR-MEDICATIONS'}],
    allergies:[],
    labs:[
      {id:'lab-a1c-d1',code:'SYNTH-A1C',display:'Hemoglobin A1c',value:8.4,unit:'%',observedAt:'2026-09-10T10:15:00Z',flag:'high-demo',source:'LAB-SYSTEM'},
      {id:'lab-a1c-d0',code:'SYNTH-A1C',display:'Hemoglobin A1c',value:7.5,unit:'%',observedAt:'2026-05-11T10:00:00Z',flag:'review-demo',source:'LAB-SYSTEM'},
      {id:'lab-glu-d1',code:'SYNTH-GLU',display:'Fasting glucose',value:182,unit:'mg/dL',observedAt:'2026-09-10T10:15:00Z',flag:'high-demo',source:'LAB-SYSTEM'},
      {id:'lab-cr-d1',code:'SYNTH-CREAT',display:'Creatinine',value:1.0,unit:'mg/dL',observedAt:'2026-09-10T10:15:00Z',flag:'normal-demo',source:'LAB-SYSTEM'}
    ],
    encounters:[{id:'enc-504',type:'outpatient',start:'2026-09-10T11:00:00Z',reason:'Diabetes follow-up and trend review',clinician:'endo-001',source:'EHR-ENCOUNTERS'}],
    notes:[],referrals:[],carePlans:[{id:'cp-d1',status:'active',text:'Synthetic diabetes follow-up plan.',source:'EHR-CAREPLAN'}],
    appointments:[{id:'apt-d1',date:'2026-10-15T13:30:00Z',clinic:'Helios Endocrinology Clinic',status:'booked'}],
    approvedInstructions:[{id:'inst-d1',text:'Bring your home monitoring log and current medication list to the next appointment.',approvedBy:'endo-001'}]
  },
  'pat-1005': {
    id:'pat-1005',tenant:'helios-north',pseudonym:'HN-P-6E90C7',name:'Thomas Becker',birthYear:1946,
    conditions:[{id:'cond-e1',code:'I48.91',display:'Atrial fibrillation',status:'active',source:'EHR-CONDITIONS'}],
    medications:[{id:'med-e1',code:'SYNTH-ANTICOAG-A',display:'Synthetic anticoagulant fixture',dose:'1 demo-tablet daily',status:'active',source:'EHR-MEDICATIONS'}],
    allergies:[],
    labs:[
      {id:'lab-inr-e1',code:'SYNTH-INR',display:'INR',value:3.7,unit:'ratio',observedAt:'2026-09-19T08:00:00Z',flag:'high-demo',source:'LAB-SYSTEM'},
      {id:'lab-inr-e0',code:'SYNTH-INR',display:'INR',value:2.4,unit:'ratio',observedAt:'2026-09-02T08:00:00Z',flag:'normal-demo',source:'LAB-SYSTEM'},
      {id:'lab-hgb-e1',code:'SYNTH-HGB',display:'Hemoglobin',value:11.0,unit:'g/dL',observedAt:'2026-09-19T08:00:00Z',flag:'low-demo',source:'LAB-SYSTEM'}
    ],
    encounters:[{id:'enc-505',type:'outpatient',start:'2026-09-19T09:00:00Z',reason:'Anticoagulation monitoring review',clinician:'pharm-001',source:'EHR-ENCOUNTERS'}],
    notes:[],referrals:[],carePlans:[],appointments:[{id:'apt-e1',date:'2026-09-30T09:00:00Z',clinic:'Helios Anticoagulation Service',status:'booked'}],
    approvedInstructions:[{id:'inst-e1',text:'Attend the scheduled anticoagulation follow-up and bring an updated medication list.',approvedBy:'pharm-001'}]
  },
  'pat-1006': {
    id:'pat-1006',tenant:'helios-north',pseudonym:'HN-P-1B72E9',name:'Olivia Chen',birthYear:1964,
    conditions:[{id:'cond-f1',code:'D50.9',display:'Iron-deficiency anemia',status:'active',source:'EHR-CONDITIONS'}],
    medications:[],allergies:[],
    labs:[
      {id:'lab-hgb-f1',code:'SYNTH-HGB',display:'Hemoglobin',value:8.3,unit:'g/dL',observedAt:'2026-09-17T07:45:00Z',flag:'low-demo',source:'LAB-SYSTEM'},
      {id:'lab-fer-f1',code:'SYNTH-FERRITIN',display:'Ferritin',value:9,unit:'ng/mL',observedAt:'2026-09-17T07:45:00Z',flag:'low-demo',source:'LAB-SYSTEM'},
      {id:'lab-hgb-f0',code:'SYNTH-HGB',display:'Hemoglobin',value:10.1,unit:'g/dL',observedAt:'2026-07-02T07:45:00Z',flag:'low-demo',source:'LAB-SYSTEM'}
    ],
    encounters:[{id:'enc-506',type:'outpatient',start:'2026-09-17T10:00:00Z',reason:'Anemia trend review',clinician:'hosp-001',source:'EHR-ENCOUNTERS'}],
    notes:[],referrals:[],carePlans:[],appointments:[{id:'apt-f1',date:'2026-10-06T10:00:00Z',clinic:'Helios Internal Medicine Clinic',status:'booked'}],
    approvedInstructions:[{id:'inst-f1',text:'Complete the clinician-approved follow-up plan before the next visit.',approvedBy:'hosp-001'}]
  },
  'pat-1007': {
    id:'pat-1007',tenant:'helios-north',pseudonym:'HN-P-3A19D5',name:'Robert Miles',birthYear:1955,
    conditions:[{id:'cond-g1',code:'J18.9',display:'Recent pneumonia episode',status:'recovering',source:'EHR-CONDITIONS'}],
    medications:[{id:'med-g1',code:'SYNTH-DISCHARGE-A',display:'Synthetic discharge medication fixture',dose:'completed',status:'completed',source:'EHR-MEDICATIONS'}],
    allergies:[],
    labs:[
      {id:'lab-wbc-g1',code:'SYNTH-WBC',display:'White blood cell count',value:8.1,unit:'10^3/uL',observedAt:'2026-09-12T07:20:00Z',flag:'normal-demo',source:'LAB-SYSTEM'},
      {id:'lab-cr-g1',code:'SYNTH-CREAT',display:'Creatinine',value:0.9,unit:'mg/dL',observedAt:'2026-09-12T07:20:00Z',flag:'normal-demo',source:'LAB-SYSTEM'}
    ],
    encounters:[{id:'enc-507',type:'post-discharge',start:'2026-09-12T13:00:00Z',reason:'Post-discharge medication reconciliation',clinician:'care-001',source:'EHR-ENCOUNTERS'}],
    notes:[],referrals:[],carePlans:[{id:'cp-g1',status:'active',text:'Synthetic transition-of-care follow-up.',source:'EHR-CAREPLAN'}],appointments:[{id:'apt-g1',date:'2026-09-26T13:00:00Z',clinic:'Helios Transitions Clinic',status:'booked'}],approvedInstructions:[{id:'inst-g1',text:'Follow the approved discharge instructions and attend the scheduled follow-up visit.',approvedBy:'hosp-001'}]
  },
  'pat-west-3001': {
    id:'pat-west-3001',tenant:'helios-west',pseudonym:'HW-P-5B22C4',name:'Maya Johnson',birthYear:1991,
    conditions:[{id:'cond-w1',code:'G43.909',display:'Migraine history',status:'active',source:'EHR-CONDITIONS'}],
    medications:[],allergies:[],labs:[{id:'lab-w1',code:'SYNTH-HGB',display:'Hemoglobin',value:13.1,unit:'g/dL',observedAt:'2026-09-11T11:00:00Z',flag:'normal-demo',source:'LAB-SYSTEM'}],
    encounters:[{id:'enc-west-301',type:'outpatient',start:'2026-09-11T11:30:00Z',reason:'Primary-care follow-up',clinician:'west-001',source:'EHR-ENCOUNTERS'}],
    notes:[],referrals:[],carePlans:[],appointments:[{id:'apt-w1',date:'2026-10-10T11:00:00Z',clinic:'Helios West Primary Care',status:'booked'}],approvedInstructions:[{id:'inst-w1',text:'Bring your symptom diary to the next primary-care visit.',approvedBy:'west-001'}]
  },
  'pat-br-2001': {
    id:'pat-br-2001',tenant:'aurora-br',pseudonym:'AS-P-A81C09',name:'Carlos Ferreira',birthYear:1969,
    conditions:[{id:'cond-br1',code:'E11.9',display:'Diabetes tipo 2',status:'active',source:'EHR-CONDITIONS'}],
    medications:[{id:'med-br1',code:'SYNTH-MED-C',display:'Medicamento sintético para diabetes',dose:'20 unidades-demo',status:'active',source:'EHR-MEDICATIONS'}],
    allergies:[{id:'alg-br1',code:'SYNTH-CLASS-X',display:'Alergia sintética classe X',criticality:'medium',source:'EHR-ALLERGIES'}],
    labs:[
      {id:'lab-br1',code:'SYNTH-A1C',display:'Hemoglobina glicada',value:7.8,unit:'%',observedAt:'2026-09-15T11:00:00Z',flag:'review-demo',source:'LAB-SYSTEM'},
      {id:'lab-br2',code:'SYNTH-CREAT',display:'Creatinina',value:1.2,unit:'mg/dL',observedAt:'2026-09-15T11:00:00Z',flag:'normal-demo',source:'LAB-SYSTEM'}
    ],
    encounters:[{id:'enc-br1',type:'outpatient',start:'2026-09-15T10:30:00Z',reason:'Acompanhamento de diabetes',clinician:'clin-br-001',source:'EHR-ENCOUNTERS'}],
    notes:[],referrals:[],carePlans:[],appointments:[{id:'apt-br1',date:'2026-10-08T13:00:00Z',clinic:'Ambulatório Aurora',status:'booked'}],approvedInstructions:[{id:'inst-br1',text:'Levar a lista atualizada de medicamentos para a próxima consulta.',approvedBy:'clin-br-001'}]
  },
  'pat-br-2002': {
    id:'pat-br-2002',tenant:'aurora-br',pseudonym:'AS-P-7D34B2',name:'Ana Martins',birthYear:1957,
    conditions:[{id:'cond-br2',code:'I50.9',display:'Insuficiência cardíaca',status:'active',source:'EHR-CONDITIONS'}],
    medications:[{id:'med-br2',code:'SYNTH-CARDIO-BR',display:'Medicamento sintético cardiovascular',dose:'1 unidade-demo diária',status:'active',source:'EHR-MEDICATIONS'}],
    allergies:[],labs:[
      {id:'lab-br-bnp',code:'SYNTH-BNP',display:'BNP',value:640,unit:'pg/mL',observedAt:'2026-09-20T09:00:00Z',flag:'high-demo',source:'LAB-SYSTEM'},
      {id:'lab-br-na',code:'SYNTH-NA',display:'Sódio',value:133,unit:'mmol/L',observedAt:'2026-09-20T09:00:00Z',flag:'low-demo',source:'LAB-SYSTEM'}
    ],
    encounters:[{id:'enc-br2',type:'outpatient',start:'2026-09-20T10:00:00Z',reason:'Revisão cardiológica pós-alta',clinician:'cardio-br-001',source:'EHR-ENCOUNTERS'}],
    notes:[],referrals:[],carePlans:[],appointments:[{id:'apt-br2',date:'2026-10-03T10:30:00Z',clinic:'Cardiologia Aurora',status:'booked'}],approvedInstructions:[{id:'inst-br2',text:'Seguir as orientações de alta aprovadas e comparecer ao retorno.',approvedBy:'cardio-br-001'}]
  }
};

workforce['er-001']={
  id:'er-001',
  tenant:'helios-north',
  display:'Dr. Maya Patel',
  role:'emergency-physician',
  specialty:'Emergency Medicine',
  scopes:['chart:summary','labs:read','medications:read','allergies:read','conditions:read','knowledge:read','medication-safety:read']
};

export const patientSupportUsers = {
  'portal-1001': {id:'portal-1001',display:'Marcus Reed',tenant:'helios-north',patient:'pat-1001',role:'patient',scopes:['appointment:own:read','instructions:own:read','education:read','callback:request']},
  'portal-1002': {id:'portal-1002',display:'Elena Torres',tenant:'helios-north',patient:'pat-1002',role:'patient',scopes:['appointment:own:read','instructions:own:read','education:read','callback:request']},
  'portal-1003': {id:'portal-1003',display:'George Campbell',tenant:'helios-north',patient:'pat-1003',role:'patient',scopes:['appointment:own:read','instructions:own:read','education:read','callback:request']},
  'portal-1004': {id:'portal-1004',display:'Nadia Rahman',tenant:'helios-north',patient:'pat-1004',role:'patient',scopes:['appointment:own:read','instructions:own:read','education:read','callback:request']},
  'portal-1005': {id:'portal-1005',display:'Thomas Becker',tenant:'helios-north',patient:'pat-1005',role:'patient',scopes:['appointment:own:read','instructions:own:read','education:read','callback:request']},
  'portal-1006': {id:'portal-1006',display:'Olivia Chen',tenant:'helios-north',patient:'pat-1006',role:'patient',scopes:['appointment:own:read','instructions:own:read','education:read','callback:request']},
  'portal-1007': {id:'portal-1007',display:'Robert Miles',tenant:'helios-north',patient:'pat-1007',role:'patient',scopes:['appointment:own:read','instructions:own:read','education:read','callback:request']},
  'portal-west-3001': {id:'portal-west-3001',display:'Maya Johnson',tenant:'helios-west',patient:'pat-west-3001',role:'patient',scopes:['appointment:own:read','instructions:own:read','education:read','callback:request']},
  'portal-br-2001': {id:'portal-br-2001',display:'Carlos Ferreira',tenant:'aurora-br',patient:'pat-br-2001',role:'patient',scopes:['appointment:own:read','instructions:own:read','education:read','callback:request']},
  'portal-br-2002': {id:'portal-br-2002',display:'Ana Martins',tenant:'aurora-br',patient:'pat-br-2002',role:'patient',scopes:['appointment:own:read','instructions:own:read','education:read','callback:request']}
};

export const encountersById = Object.fromEntries(Object.values(patients).flatMap(p => p.encounters.map(e => [e.id, {...e, patient:p.id, tenant:p.tenant}])));

export const syntheticSafetyRules = {
  version:'demo-safety-rules-2026.09',
  disclaimer:'SYNTHETIC DEMONSTRATION RULES ONLY — NOT A MEDICAL KNOWLEDGE ENGINE OR PRESCRIBING SAFETY SYSTEM.',
  allergyConflicts:[{medication:'SYNTH-DRUG-Y',allergyCode:'SYNTH-CLASS-BETA',reason:'Configured synthetic allergy conflict'}],
  interactions:[{a:'SYNTH-MED-ANTICOAG',b:'SYNTH-DRUG-Y',reason:'Configured synthetic interaction requiring review'}],
  doseBounds:[{medication:'SYNTH-DRUG-Y',max:50,unit:'demo-units',reason:'Configured demonstration dose bound'}],
  requiredContext:[{medication:'SYNTH-DRUG-Y',requires:['allergies','medications','SYNTH-CREAT'],reason:'Configured demonstration context requirement'}],
  criticalResults:[{code:'SYNTH-CRITICAL',flag:'critical-demo',reason:'Configured demonstration critical-result escalation fixture'}]
};
