import { syntheticSafetyRules } from '../data/synthetic-healthcare.mjs';
export const SAFETY_DISCLAIMER = syntheticSafetyRules.disclaimer;

export function evaluateMedicationRequest({medication,dose,unit='demo-units',patientView={}}){
  const results=[]; const codes=[];
  const required=syntheticSafetyRules.requiredContext.find(r=>r.medication===medication);
  if(required){
    const missing=[];
    if(required.requires.includes('allergies') && !Array.isArray(patientView.allergies)) missing.push('allergies');
    if(required.requires.includes('medications') && !Array.isArray(patientView.medications)) missing.push('medications');
    for(const code of required.requires.filter(x=>x.startsWith('SYNTH-'))){ if(!patientView.labs?.some(l=>l.code===code)) missing.push(code); }
    if(missing.length){ codes.push('REQUIRED_CLINICAL_CONTEXT_MISSING'); results.push({decision:'ABSTAIN',rule:'required-context',missing,reason:required.reason}); }
  }
  for(const rule of syntheticSafetyRules.allergyConflicts.filter(r=>r.medication===medication)){
    if(patientView.allergies?.some(a=>a.code===rule.allergyCode)){ codes.push('ALLERGY_CONFLICT'); results.push({decision:'BLOCK',rule:'allergy-conflict',reason:rule.reason,allergyCode:rule.allergyCode}); }
  }
  for(const rule of syntheticSafetyRules.interactions){
    const existing=patientView.medications?.map(m=>m.code)||[];
    if((rule.a===medication && existing.includes(rule.b))||(rule.b===medication && existing.includes(rule.a))){ codes.push('MEDICATION_INTERACTION_REVIEW'); results.push({decision:'REVIEW',rule:'configured-interaction',reason:rule.reason}); }
  }
  const bound=syntheticSafetyRules.doseBounds.find(r=>r.medication===medication);
  if(bound && Number(dose)>bound.max){ codes.push('DOSE_POLICY_REVIEW'); results.push({decision:'REVIEW',rule:'configured-dose-bound',reason:bound.reason,max:bound.max,unit:bound.unit}); }
  if(!results.length) results.push({decision:'PASS_DEMO_RULES',rule:'no-configured-demo-conflict',reason:'No configured synthetic demonstration rule was triggered. This is not a medical safety determination.'});
  const blocked=results.some(r=>r.decision==='BLOCK'||r.decision==='ABSTAIN');
  return {service:'helios-demo-clinical-safety',version:syntheticSafetyRules.version,disclaimer:SAFETY_DISCLAIMER,decision:blocked?'DO_NOT_ADVANCE':'REQUIRES_CLINICIAN_REVIEW',reasonCodes:[...new Set(codes)],results};
}

export function evaluateCriticalResults(patientView){
  const matches=[];
  for(const lab of patientView.labs||[]) for(const rule of syntheticSafetyRules.criticalResults) if(lab.code===rule.code && lab.flag===rule.flag) matches.push({labId:lab.id,reason:rule.reason,decision:'ESCALATE_DEMO'});
  return {disclaimer:SAFETY_DISCLAIMER,matches};
}
