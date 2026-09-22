import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

test('custom gateway build retains WSO2 policies required by banking-compatible provider/proxy flow', async()=>{
  const text=await readFile(resolve(import.meta.dirname,'../../wso2apip-healthcare-ai-gateway-1.1.0/build.yaml'),'utf8');
  for(const name of ['api-key-auth','host-rewrite','request-rewrite','respond','set-headers','subscription-validation']){
    assert.match(text,new RegExp(`- name: ${name}\\n`),name);
  }
});

test('bootstrap creates a separate provider access boundary and binds proxies to that key', async()=>{
  const src=await readFile(resolve(import.meta.dirname,'../../scripts/bootstrap-gateway.mjs'),'utf8');
  assert.match(src,/const PROVIDER_HEADER='X-API-Key'/);
  assert.match(src,/generateKey\('llm-providers',PROVIDER,'provider-access'\)/);
  assert.match(src,/obj\.spec\.provider=.*auth:\{type:'api-key',header:PROVIDER_HEADER,value:providerKey\}/s);
});

test('provider acceptance uses provider key while application calls use distinct proxy keys', async()=>{
  const acceptance=await readFile(resolve(import.meta.dirname,'../../scripts/gateway-acceptance.mjs'),'utf8');
  const client=await readFile(resolve(import.meta.dirname,'../server/services/gateway-client.mjs'),'utf8');
  assert.match(acceptance,/WSO2_PROVIDER_ACCESS_KEY/);
  assert.match(acceptance,/'X-API-Key':providerKey/);
  assert.match(client,/WSO2_CLINICAL_PROXY_API_KEY/);
  assert.match(client,/WSO2_PATIENT_PROXY_API_KEY/);
});
