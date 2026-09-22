const numberRegex=/(-?\d+(?:\.\d+)?)/g;
export function groundedLabAnswer({question,labs}){
 const q=String(question).toLowerCase(); const lab=(labs||[]).find(l=>q.includes('potassium')?l.code==='SYNTH-K':q.includes(l.display.toLowerCase())||q.includes(l.code.toLowerCase()));
 if(!lab) return {text:'The requested result is unavailable in the authorized patient-data service.',authoritativeFacts:[],reasonCodes:['TRUSTED_CLINICAL_SOURCE_REQUIRED'],evidenceType:'AUTHORITATIVE PATIENT FACT'};
 return {text:`Authorized result: ${lab.display} = ${lab.value} ${lab.unit} (observed ${lab.observedAt}).`,authoritativeFacts:[{sourceId:lab.id,source:lab.source,code:lab.code,value:lab.value,unit:lab.unit}],reasonCodes:[],evidenceType:'AUTHORITATIVE PATIENT FACT'};
}
export function validateClinicalResponse(text,{authoritativeFacts=[]}={}){
 const lower=String(text).toLowerCase(); const reasonCodes=[];
 if(/definitely\s+has|certainly\s+has|diagnosis\s+is\s+confirmed/.test(lower)) reasonCodes.push('UNSUPPORTED_CLINICAL_CERTAINTY');
 if(/prescribe|order\s+(?:this\s+)?medication|maximum\s+dose/.test(lower)) reasonCodes.push('CLINICIAN_APPROVAL_REQUIRED');
 // Any concrete SYNTH-K numeric statement must be supported by an authoritative fact with the same value.
 if(lower.includes('potassium')||lower.includes('synthetic potassium')){ const nums=[...String(text).matchAll(numberRegex)].map(m=>Number(m[1])); const fact=authoritativeFacts.find(f=>f.code==='SYNTH-K'); if(nums.length&&(!fact||!nums.some(n=>n===Number(fact.value)))) reasonCodes.push('TRUSTED_CLINICAL_SOURCE_REQUIRED'); }
 return {valid:reasonCodes.length===0,reasonCodes:[...new Set(reasonCodes)]};
}
