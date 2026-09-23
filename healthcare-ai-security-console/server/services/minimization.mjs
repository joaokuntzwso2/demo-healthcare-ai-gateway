import { patients } from '../data/synthetic-healthcare.mjs';
import { AccessError } from './context.mjs';
import { encounterWithLifecycle } from './encounter-lifecycle.mjs';

export const purposeProfiles = {
  'appointment-scheduling': { categories:['appointments'], scopes:['appointment:own:read'] },
  'encounter-summary': { categories:['encounters','conditions','medications','allergies','recentLabs'], scopes:['chart:summary'] },
  'medication-review': { categories:['medications','allergies','relevantLabs','conditions'], scopes:['medications:read','allergies:read'] },
  'lab-review': { categories:['recentLabs','encounters'], scopes:['labs:read'] },
  'note-drafting': { categories:['encounters','conditions','medications','allergies','recentLabs'], scopes:['note:draft'] },
  'patient-support': { categories:['appointments','approvedInstructions'], scopes:['appointment:own:read','instructions:own:read'] },
  'patient-education': { categories:[], scopes:['education:read'] }
};

function requireAnyScope(context, expected){ if(expected.length && !expected.some(s=>context.scopes.includes(s))) throw new AccessError('CLINICAL_DATA_NOT_AUTHORIZED',`Purpose requires one of: ${expected.join(', ')}`); }

export function minimizedPatientView(context, purpose=context.purpose){
  const profile = purposeProfiles[purpose];
  if (!profile) throw new AccessError('PURPOSE_SCOPE_EXCEEDED',`Unsupported purpose: ${purpose}`);
  requireAnyScope(context, profile.scopes);
  const patient = patients[context.patient.id];
  if (!patient || patient.tenant !== context.tenant) throw new AccessError('PATIENT_SCOPE_MISMATCH','Patient context is outside tenant boundary.');
  const out={patient:{pseudonym:patient.pseudonym},purpose,categoriesReleased:[]};
  for(const category of profile.categories){
    if(category==='encounters'){ out.encounters=patient.encounters.filter(e=>!context.encounter || e.id===context.encounter).map(encounterWithLifecycle); out.categoriesReleased.push('encounters'); }
    if(category==='conditions'){ out.conditions=patient.conditions; out.categoriesReleased.push('conditions'); }
    if(category==='medications'){ out.medications=patient.medications; out.categoriesReleased.push('medications'); }
    if(category==='allergies'){ out.allergies=patient.allergies; out.categoriesReleased.push('allergies'); }
    if(category==='recentLabs' || category==='relevantLabs'){ out.labs=patient.labs.slice(0,5); out.categoriesReleased.push('labs'); }
    if(category==='appointments'){ out.appointments=patient.appointments; out.categoriesReleased.push('appointments'); }
    if(category==='approvedInstructions'){ out.approvedInstructions=patient.approvedInstructions; out.categoriesReleased.push('approvedInstructions'); }
  }
  return out;
}

export function assertCategoryAllowed(context, category){
  const profile=purposeProfiles[context.purpose];
  const normalized = category==='labs' ? ['recentLabs','relevantLabs'] : [category];
  if(!profile || !normalized.some(c=>profile.categories.includes(c))) throw new AccessError('PURPOSE_SCOPE_EXCEEDED',`${category} is not released for purpose ${context.purpose}.`);
}
