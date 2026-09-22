import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const expected=JSON.parse(await readFile(resolve(root,'config/policy-order.json'),'utf8'));
for(const file of ['clinical-policy-chain.json','patient-support-policy-chain.json']){
  const chain=JSON.parse(await readFile(resolve(root,'config',file),'utf8'));
  const names=chain.map(x=>x.name);
  if(JSON.stringify(names)!==JSON.stringify(expected)) throw new Error(`${file}: security-significant policy order mismatch`);
  if(names[0]!=='api-key-auth') throw new Error(`${file}: api-key-auth must be first`);
  if(names[3]!=='canonicalize-and-classify') throw new Error(`${file}: canonicalization must precede content checks`);
  if(names.at(-1)!=='request-rewrite') throw new Error(`${file}: WSO2 request-rewrite must be last`);
  for(const [i,stage] of chain.entries()){
    for(const binding of (stage.paths||[])){
      if(i>0 && binding.path!=='/chat/completions') throw new Error(`${file}: ${stage.name} must match WSO2 AI Gateway 1.2 /chat/completions, got ${binding.path}`);
    }
  }
  const expectedApp=chain.find(x=>x.name==='custom-tenant-workforce-context-guard').paths[0].params.expectedApp;
  if(file.startsWith('clinical')&&expectedApp!=='clinician') throw new Error('clinician proxy binding missing');
  if(file.startsWith('patient')&&expectedApp!=='patient-support') throw new Error('patient proxy binding missing');
}
console.log('Policy-chain order and WSO2 AI Gateway 1.2 /chat/completions binding validated.');
