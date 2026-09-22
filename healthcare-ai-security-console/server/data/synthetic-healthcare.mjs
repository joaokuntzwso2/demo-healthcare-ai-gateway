export const organizations = {
  'helios-north': { id: 'helios-north', name: 'Helios North Teaching Hospital', jurisdiction: 'US', type: 'hospital' },
  'aurora-br': { id: 'aurora-br', name: 'Aurora Saúde Integrada', jurisdiction: 'BR', type: 'integrated-care' }
};

export const workforce = {
  'clin-001': { id: 'clin-001', tenant: 'helios-north', display: 'Dr. Avery Morgan', role: 'attending-physician', scopes: ['chart:summary','labs:read','medications:read','allergies:read','conditions:read','knowledge:read','note:draft','clinical-action:request','approval:submit'] },
  'pharm-001': { id: 'pharm-001', tenant: 'helios-north', display: 'Morgan Lee, PharmD', role: 'clinical-pharmacist', scopes: ['medications:read','allergies:read','labs:read','knowledge:read','medication-safety:read'] },
  'nurse-001': { id: 'nurse-001', tenant: 'helios-north', display: 'Jordan Chen, RN', role: 'registered-nurse', scopes: ['chart:summary','labs:read','allergies:read','knowledge:read','note:draft'] },
  'clin-br-001': { id: 'clin-br-001', tenant: 'aurora-br', display: 'Dra. Marina Silva', role: 'attending-physician', scopes: ['chart:summary','labs:read','medications:read','allergies:read','conditions:read','knowledge:read','note:draft','clinical-action:request','approval:submit'] }
};

export const patients = {
  'pat-1001': {
    id: 'pat-1001', tenant: 'helios-north', pseudonym: 'HN-P-7F21A8', name: 'Synthetic Patient Alpha', birthYear: 1977,
    conditions: [
      { id:'cond-1', code:'SYNTH-HTN', display:'Synthetic chronic condition A', status:'active', source:'EHR-CONDITIONS' },
      { id:'cond-2', code:'SYNTH-CKD2', display:'Synthetic renal context fixture', status:'active', source:'EHR-CONDITIONS' }
    ],
    medications: [
      { id:'med-1', code:'SYNTH-MED-A', display:'Demo Medication A', dose:'10 demo-units', status:'active', source:'EHR-MEDICATIONS' },
      { id:'med-2', code:'SYNTH-MED-ANTICOAG', display:'Demo Anticoagulant', dose:'2 demo-units', status:'active', source:'EHR-MEDICATIONS' }
    ],
    allergies: [{ id:'alg-1', code:'SYNTH-CLASS-BETA', display:'Demo Beta-Class Allergy', criticality:'high', source:'EHR-ALLERGIES' }],
    labs: [
      { id:'lab-k-1', code:'SYNTH-K', display:'Synthetic potassium fixture', value:4.2, unit:'demo-unit/L', observedAt:'2026-09-16T09:20:00Z', flag:'normal-demo', source:'LAB-SYSTEM' },
      { id:'lab-cr-1', code:'SYNTH-CREAT', display:'Synthetic renal fixture', value:1.1, unit:'demo-unit', observedAt:'2026-09-16T09:20:00Z', flag:'normal-demo', source:'LAB-SYSTEM' }
    ],
    encounters: [{ id:'enc-501', type:'outpatient', start:'2026-09-16T09:00:00Z', reason:'Synthetic medication-review visit', clinician:'clin-001', source:'EHR-ENCOUNTERS' }],
    notes: [{ id:'note-1', encounter:'enc-501', text:'Synthetic note: patient reports no new symptoms. This text is demonstrative only.', author:'clin-001', source:'EHR-NOTES' }],
    referrals: [{ id:'ref-safe-1', encounter:'enc-501', sourceType:'external-referral', text:'Synthetic referral: review current medication list at next visit.', authority:'untrusted-evidence' }],
    carePlans: [{ id:'cp-1', status:'active', text:'Synthetic follow-up plan for demonstration.', source:'EHR-CAREPLAN' }],
    appointments: [{ id:'apt-1', date:'2026-10-04T14:00:00Z', clinic:'Demo Ambulatory Clinic', status:'booked' }],
    approvedInstructions: [{ id:'inst-1', text:'Synthetic approved instruction: bring your medication list to the next appointment.', approvedBy:'clin-001' }]
  },
  'pat-1002': {
    id:'pat-1002', tenant:'helios-north', pseudonym:'HN-P-2C90D1', name:'Synthetic Patient Beta', birthYear:1988,
    conditions:[{id:'cond-b1',code:'SYNTH-ASTHMA',display:'Synthetic condition B',status:'active',source:'EHR-CONDITIONS'}],
    medications:[{id:'med-b1',code:'SYNTH-MED-B',display:'Demo Medication B',dose:'5 demo-units',status:'active',source:'EHR-MEDICATIONS'}],
    allergies:[],
    labs:[],
    encounters:[{id:'enc-502',type:'telehealth',start:'2026-09-14T15:00:00Z',reason:'Synthetic follow-up',clinician:'nurse-001',source:'EHR-ENCOUNTERS'}],
    notes:[], referrals:[], carePlans:[], appointments:[{id:'apt-b1',date:'2026-10-12T16:30:00Z',clinic:'Demo Respiratory Clinic',status:'booked'}], approvedInstructions:[]
  },
  'pat-br-2001': {
    id:'pat-br-2001', tenant:'aurora-br', pseudonym:'AS-P-A81C09', name:'Paciente Sintético Gama', birthYear:1969,
    conditions:[{id:'cond-br1',code:'SYNTH-DM',display:'Condição sintética C',status:'active',source:'EHR-CONDITIONS'}],
    medications:[{id:'med-br1',code:'SYNTH-MED-C',display:'Medicamento Demonstrativo C',dose:'20 unidades-demo',status:'active',source:'EHR-MEDICATIONS'}],
    allergies:[{id:'alg-br1',code:'SYNTH-CLASS-X',display:'Alergia sintética classe X',criticality:'medium',source:'EHR-ALLERGIES'}],
    labs:[{id:'lab-br1',code:'SYNTH-A1C',display:'Exame sintético',value:7.0,unit:'demo-%',observedAt:'2026-09-15T11:00:00Z',flag:'review-demo',source:'LAB-SYSTEM'}],
    encounters:[{id:'enc-br1',type:'outpatient',start:'2026-09-15T10:30:00Z',reason:'Consulta sintética',clinician:'clin-br-001',source:'EHR-ENCOUNTERS'}],
    notes:[], referrals:[], carePlans:[], appointments:[{id:'apt-br1',date:'2026-10-08T13:00:00Z',clinic:'Clínica Demonstrativa',status:'booked'}], approvedInstructions:[{id:'inst-br1',text:'Instrução sintética previamente aprovada.',approvedBy:'clin-br-001'}]
  }
};

export const patientSupportUsers = {
  'portal-1001': { id:'portal-1001', tenant:'helios-north', patient:'pat-1001', role:'patient', scopes:['appointment:own:read','instructions:own:read','education:read','callback:request'] },
  'portal-br-2001': { id:'portal-br-2001', tenant:'aurora-br', patient:'pat-br-2001', role:'patient', scopes:['appointment:own:read','instructions:own:read','education:read','callback:request'] }
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
