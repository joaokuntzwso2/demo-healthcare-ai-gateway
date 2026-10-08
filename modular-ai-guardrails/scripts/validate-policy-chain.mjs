import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const expected=JSON.parse(await readFile(resolve(root,'config/policy-order.json'),'utf8'));
for(const file of ['clinical-policy-chain.json','patient-support-policy-chain.json']){
  const chain=JSON.parse(await readFile(resolve(root,'config',file),'utf8'));
  const names=chain.map(x=>x.name);
  if(JSON.stringify(names)!==JSON.stringify(expected)) throw new Error(`${file}: security-significant policy order mismatch`);
  if(names.length!==27) throw new Error(`${file}: expected 27 P1 Gateway stages, got ${names.length}`);
  if(names[0]!=='api-key-auth') throw new Error(`${file}: api-key-auth must be first`);
  if(names.at(-1)!=='request-rewrite') throw new Error(`${file}: WSO2 request-rewrite must be last`);
  if(names.indexOf('canonicalize-and-classify')>names.indexOf('regex-guardrail')) throw new Error(`${file}: canonicalization must precede the Argentina regex DLP`);
  if(names.indexOf('regex-guardrail')>names.indexOf('custom-jailbreak-authority-bypass-guardrail')) throw new Error(`${file}: native Argentina regex DLP must precede downstream prompt-security checks`);
  if(names.indexOf('llm-cost-based-ratelimit')>names.indexOf('llm-cost')) throw new Error(`${file}: llm-cost-based-ratelimit must precede llm-cost in the declared list`);
  for(const [i,stage] of chain.entries()){
    for(const binding of (stage.paths||[])){
      if(i>0 && binding.path!=='/chat/completions') throw new Error(`${file}: ${stage.name} must match WSO2 AI Gateway 1.2 /chat/completions, got ${binding.path}`);
    }
  }
  const expectedApp=chain.find(x=>x.name==='custom-tenant-workforce-context-guard').paths[0].params.expectedApp;
  if(file.startsWith('clinical')&&expectedApp!=='clinician') throw new Error('clinician proxy binding missing');
  if(file.startsWith('patient')&&expectedApp!=='patient-support') throw new Error('patient proxy binding missing');
}
console.log('P1 policy-chain order, provenance and WSO2 AI Gateway 1.2 bindings validated.');
