const sensitivePatterns=[
  {name:'email',re:/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi},
  {name:'phone',re:/\+?\d[\d\s().-]{7,}\d/g},
  {name:'ssn-like',re:/\b\d{3}-\d{2}-\d{4}\b/g},
  {name:'secret',re:/\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/gi},
  {name:'synthetic-patient-name',re:/\b(?:Synthetic Patient Alpha|Synthetic Patient Beta|Paciente Sintético Gama)\b/gi}
];
export function redactText(text=''){ let out=String(text); const findings=[]; for(const p of sensitivePatterns){ out=out.replace(p.re,m=>{findings.push(p.name);return `[REDACTED:${p.name.toUpperCase()}]`;}); } return {text:out,findings:[...new Set(findings)]}; }
export function safeLogRecord(record){
  const clone=structuredClone(record||{});
  for(const key of ['prompt','response','rawPayload','clinicalText','patientName']) if(key in clone){ const r=redactText(String(clone[key])); clone[key]=r.text; clone.redactionFindings=[...(clone.redactionFindings||[]),...r.findings]; }
  if(clone.patientId){ clone.patientPseudonym=clone.patientPseudonym||'PSEUDONYM_REQUIRED'; delete clone.patientId; }
  clone.redactionFindings=[...new Set(clone.redactionFindings||[])]; return clone;
}
export function detectSensitive(text=''){ return redactText(text).findings; }
