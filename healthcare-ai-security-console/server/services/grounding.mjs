const numberRegex=/(-?\d+(?:\.\d+)?)/g;
const LAB_ALIASES={
  'SYNTH-K':['potassium'],
  'SYNTH-CREAT':['creatinine','renal function','kidney function'],
  'SYNTH-EGFR':['egfr','estimated gfr','renal function','kidney function'],
  'SYNTH-A1C':['a1c','hba1c','hemoglobin a1c','glicada'],
  'SYNTH-GLU':['glucose','glicose'],
  'SYNTH-INR':['inr','anticoagulation'],
  'SYNTH-HGB':['hemoglobin','haemoglobin'],
  'SYNTH-FERRITIN':['ferritin'],
  'SYNTH-BNP':['bnp'],
  'SYNTH-NA':['sodium','sódio'],
  'SYNTH-EOS':['eosinophil','eosinophils'],
  'SYNTH-WBC':['white blood cell','white blood cells','wbc']
};
function aliasesFor(lab){return [...new Set([String(lab.display||'').toLowerCase(),String(lab.code||'').toLowerCase(),...(LAB_ALIASES[lab.code]||[])].filter(Boolean))];}
function questionMatchesLab(question,lab){const q=String(question||'').toLowerCase();return aliasesFor(lab).some(a=>q.includes(a));}

export function groundedLabAnswer({question,labs}){
 const matching=(labs||[]).filter(l=>questionMatchesLab(question,l));
 if(!matching.length) return {text:'The requested result is unavailable in the authorized patient-data service.',authoritativeFacts:[],reasonCodes:['TRUSTED_CLINICAL_SOURCE_REQUIRED'],evidenceType:'AUTHORITATIVE PATIENT FACT'};
 const shown=matching.slice(0,3);
 const text=shown.map(l=>`${l.display} = ${l.value} ${l.unit} (observed ${l.observedAt})`).join('; ');
 return {text:`Authorized result${shown.length>1?'s':''}: ${text}.`,authoritativeFacts:shown.map(l=>({sourceId:l.id,source:l.source,code:l.code,display:l.display,value:l.value,unit:l.unit,observedAt:l.observedAt})),reasonCodes:[],evidenceType:'AUTHORITATIVE PATIENT FACT'};
}

export function validateClinicalResponse(text,{authoritativeFacts=[]}={}){
 const lower=String(text).toLowerCase(); const reasonCodes=[];
 if(/definitely\s+has|certainly\s+has|diagnosis\s+is\s+confirmed/.test(lower)) reasonCodes.push('UNSUPPORTED_CLINICAL_CERTAINTY');
 if(/prescribe|order\s+(?:this\s+)?medication|maximum\s+dose/.test(lower)) reasonCodes.push('CLINICIAN_APPROVAL_REQUIRED');
 const nums=[...String(text).matchAll(numberRegex)].map(m=>Number(m[1]));
 const grouped=new Map();
 for(const fact of authoritativeFacts){
   const key=String(fact.code||fact.display||'unknown');
   if(!grouped.has(key))grouped.set(key,[]);
   grouped.get(key).push(fact);
 }
 for(const facts of grouped.values()){
   const aliases=[...new Set(facts.flatMap(f=>[String(f.display||'').toLowerCase(),String(f.code||'').toLowerCase(),...(LAB_ALIASES[f.code]||[])]).filter(Boolean))];
   if(!aliases.some(a=>lower.includes(a))) continue;
   if(nums.length&&!nums.some(n=>facts.some(f=>n===Number(f.value)))) reasonCodes.push('TRUSTED_CLINICAL_SOURCE_REQUIRED');
 }
 return {valid:reasonCodes.length===0,reasonCodes:[...new Set(reasonCodes)]};
}
