import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');

test('presentation UI only uses governed AI and evidence APIs',async()=>{
  const app=await readFile(resolve(root,'public/app.js'),'utf8');
  for(const path of ['/api/copilot','/api/patient-support','/api/demo/guardrail-probe','/api/demo/catalog','/api/traces','/api/gateway-status']) assert.match(app,new RegExp(path.replaceAll('/','\\/')));
  for(const retired of ['/api/reference-data','/api/scenarios','/api/knowledge/ingest','/api/overview']) assert.doesNotMatch(app,new RegExp(retired.replaceAll('/','\\/')));
});

test('server retires direct fixture APIs from the presentation surface',async()=>{
  const server=await readFile(resolve(root,'server/index.mjs'),'utf8');
  assert.match(server,/DIRECT_FIXTURE_ACCESS_DISABLED/);
  assert.match(server,/\/api\/demo\/guardrail-probe/);
  assert.match(server,/runGatewayGuardrailProbe/);
});
