import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

test('gateway client uses explicit WSO2 1.2 proxy contexts and /chat/completions', async()=>{
  const src=await readFile(resolve(import.meta.dirname,'../server/services/gateway-client.mjs'),'utf8');
  assert.match(src,/WSO2_CLINICAL_PROXY_CONTEXT/);
  assert.match(src,/WSO2_PATIENT_PROXY_CONTEXT/);
  assert.match(src,/proxyContext}\/chat\/completions/);
  assert.doesNotMatch(src,/proxy}\/v1\/chat\/completions/);
  assert.match(src,/X-Helios-Clinical-Context/);
  assert.match(src,/X-Helios-Clinical-Signature/);
});

test('Helios chain uses WSO2 1.2 /chat/completions and request-rewrite last', async()=>{
  const base=resolve(import.meta.dirname,'../../modular-ai-guardrails/config');
  for(const file of ['clinical-policy-chain.json','patient-support-policy-chain.json']){
    const chain=JSON.parse(await readFile(resolve(base,file),'utf8'));
    assert.equal(chain.length,24);
    assert.equal(chain[0].name,'api-key-auth');
    assert.equal(chain.at(-1).name,'request-rewrite');
    for(const stage of chain.slice(1)){
      for(const path of (stage.paths||[])) assert.equal(path.path,'/chat/completions',`${file}: ${stage.name}`);
    }
    const rewrite=chain.at(-1).paths[0];
    assert.equal(rewrite.params.pathRewrite.type,'ReplaceFullPath');
    assert.equal(rewrite.params.pathRewrite.replaceFullPath,'/chat/completions');
  }
});

test('prompt decorator strips internal clinical authority headers before provider hop', async()=>{
  const src=await readFile(resolve(import.meta.dirname,'../../modular-ai-guardrails/policies/custom-prompt-decorator/custom_prompt_decorator.go'),'utf8');
  assert.match(src,/HeadersToRemove:\s*\[\]string\{"X-Helios-Clinical-Context",\s*"X-Helios-Clinical-Signature"\}/);
});
