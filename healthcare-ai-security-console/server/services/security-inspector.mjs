import { redactText } from './redaction.mjs';
const jailbreak=[/ignore\s+(?:all\s+)?(?:prior|previous)\s+instructions/i,/bypass\s+(?:the\s+)?(?:policy|guardrail|authorization)/i,/act\s+as\s+(?:an?\s+)?unrestricted/i,/developer\s+mode/i];
const authority=[/pretend\s+(?:i|the user)\s+(?:am|is)\s+(?:the\s+)?(?:doctor|clinician|admin)/i,/forge\s+(?:approval|authorization)/i,/mark\s+.*approved/i];
const clinicalCertainty=[/patient\s+definitely\s+has/i,/diagnosis\s+is\s+confirmed/i,/recommend\s+.*maximum\s+dose/i];
const unsafeUrl=/https?:\/\/(?:bit\.ly|tinyurl\.com|example-malware\.invalid|unsafe-medical\.invalid)/i;
export function canonicalize(text=''){
 let out=String(text); try{out=decodeURIComponent(out)}catch{}
 out=out.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
 for(const m of out.matchAll(/(?:^|\s)([A-Za-z0-9+/]{24,}={0,2})(?:$|\s)/g)){try{const d=Buffer.from(m[1],'base64').toString('utf8');if(/[A-Za-z]{4}/.test(d))out+=`\n${d}`}catch{}}
 return out.normalize('NFKC');
}
export function inspectRequest({prompt='',context={},body={}}={}){
 const canonical=canonicalize(prompt); const codes=[]; const findings=[];
 if(Buffer.byteLength(JSON.stringify(body))>256*1024||(body.messages?.length||0)>32||Number(body.max_tokens||0)>4096||(body.tools?.length||0)>16){codes.push('RESOURCE_BUDGET_EXCEEDED');findings.push('resource-budget');}
 if(jailbreak.some(r=>r.test(canonical))){codes.push('JAILBREAK_OR_AUTHORITY_BYPASS');findings.push('jailbreak');}
 if(authority.some(r=>r.test(canonical))){codes.push('CLINICIAN_APPROVAL_REQUIRED');findings.push('authority-forgery');}
 const dlp=redactText(canonical).findings;if(dlp.length){codes.push('PHI_PII_SECRET_DETECTED');findings.push(...dlp);}
 if(!context.tenant||!context.actor||!context.patient){codes.push('CLINICAL_DATA_NOT_AUTHORIZED');findings.push('missing-context');}
 if(context.app==='patient-support'&&/(get_patient_summary|get_recent_labs|get_medications|request_medication_order)/i.test(canonical)){codes.push('CLINICAL_DATA_NOT_AUTHORIZED');findings.push('patient-support-tool-escalation');}
 if(clinicalCertainty.some(r=>r.test(canonical))){codes.push('UNSUPPORTED_CLINICAL_CERTAINTY');findings.push('unsupported-certainty');}
 if(unsafeUrl.test(canonical)){codes.push('UNSAFE_URL');findings.push('unsafe-url');}
 return {allow:codes.length===0,canonical,reasonCodes:[...new Set(codes)],findings:[...new Set(findings)]};
}
export function inspectResponse(text=''){
 const codes=[]; const dlp=redactText(text).findings;if(dlp.length)codes.push('PHI_PII_SECRET_LEAKAGE'); if(unsafeUrl.test(text))codes.push('UNSAFE_URL'); if(clinicalCertainty.some(r=>r.test(text)))codes.push('UNSUPPORTED_CLINICAL_CERTAINTY'); return {allow:codes.length===0,reasonCodes:[...new Set(codes)]};
}
