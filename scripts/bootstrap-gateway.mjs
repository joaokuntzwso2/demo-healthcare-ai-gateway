import {readFile, writeFile, chmod, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import crypto from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const controller = process.env.CONTROLLER_URL || 'http://localhost:9090';
const user = process.env.WSO2_ADMIN_USER || process.env.ADMIN_USER || 'admin';
const pass = process.env.WSO2_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'admin';
const openai = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const gatewayUrl = process.env.WSO2_AI_GATEWAY_URL;
if (!openai) throw new Error('OPENAI_API_KEY is required.');
if (!gatewayUrl) throw new Error('WSO2_AI_GATEWAY_URL is required.');

const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const PROVIDER = process.env.WSO2_PROVIDER_ID || 'helios-enterprise-openai';
const PROVIDER_HEADER = 'X-API-Key';
const CLINICAL = 'clinical-ai-secure';
const PATIENT = 'patient-support-ai-secure';
const CLINICAL_CONTEXT = '/default/clinical-ai-secure';
const PATIENT_CONTEXT = '/default/patient-support-ai-secure';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function req(url, {method='GET', headers={}, body} = {}) {
  const r = await fetch(url, {method, headers:{Authorization:auth, Accept:'application/json', ...headers}, body});
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return {status:r.status, ok:r.ok, data, text};
}

async function detectBase() {
  for (const suffix of ['/api/management/v1', '/api/management/v0.9']) {
    const r = await req(`${controller}${suffix}/llm-providers`);
    if (r.ok) return `${controller}${suffix}`;
  }
  throw new Error(`Could not detect WSO2 management API at ${controller}`);
}

const base = await detectBase();
console.log(`Management API: ${base}`);

function listItems(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const key of ['items','llmProxies','proxies','llmProviders','providers']) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

async function get(kind, id) {
  return req(`${base}/${kind}/${encodeURIComponent(id)}`);
}

async function revokeAllKeys(kind, id) {
  const list = await req(`${base}/${kind}/${encodeURIComponent(id)}/api-keys`);
  if (list.status === 404) return;
  if (!list.ok) throw new Error(`Listing keys for ${kind}/${id} failed HTTP ${list.status}: ${list.text}`);
  const keys = Array.isArray(list.data?.apiKeys) ? list.data.apiKeys : [];
  for (const key of keys) {
    if (!key?.name) continue;
    const r = await req(`${base}/${kind}/${encodeURIComponent(id)}/api-keys/${encodeURIComponent(key.name)}`, {method:'DELETE'});
    if (!r.ok && r.status !== 404) throw new Error(`Revoking key ${key.name} from ${id} failed HTTP ${r.status}: ${r.text}`);
  }
  if (keys.length) console.log(`${id}: revoked ${keys.length} existing API key(s).`);
}

async function deleteProxy(id) {
  const cur = await get('llm-proxies', id);
  if (cur.status === 404) return;
  if (!cur.ok) throw new Error(`Proxy lookup ${id} failed HTTP ${cur.status}: ${cur.text}`);
  await revokeAllKeys('llm-proxies', id);
  const d = await req(`${base}/llm-proxies/${encodeURIComponent(id)}`, {method:'DELETE'});
  if (!d.ok && d.status !== 404) throw new Error(`Deleting proxy ${id} failed HTTP ${d.status}: ${d.text}`);
  console.log(`Deleted proxy ${id}.`);
}

async function purgeAllProxies() {
  const list = await req(`${base}/llm-proxies`);
  if (!list.ok) throw new Error(`Listing LLM proxies failed HTTP ${list.status}: ${list.text}`);
  const ids = listItems(list.data).map(x => x?.metadata?.name || x?.id || x?.name).filter(Boolean);
  for (const id of ids) await deleteProxy(id);
  // Defensive cleanup for the two demo handles in case this API version does not list them in the expected shape.
  for (const id of [CLINICAL, PATIENT]) await deleteProxy(id);
}

async function assertNoProxiesRemain() {
  await sleep(500);
  const list = await req(`${base}/llm-proxies`);
  if (!list.ok) throw new Error(`Verifying proxy cleanup failed HTTP ${list.status}: ${list.text}`);
  const ids = listItems(list.data).map(x => x?.metadata?.name || x?.id || x?.name).filter(Boolean);
  if (ids.length) throw new Error(`Proxy cleanup did not converge; remaining proxies: ${ids.join(', ')}`);
}

async function purgeNonOpenAIProviders() {
  const list = await req(`${base}/llm-providers`);
  if (!list.ok) throw new Error(`Listing LLM providers failed HTTP ${list.status}: ${list.text}`);
  for (const item of listItems(list.data)) {
    const id = item?.metadata?.name || item?.id || item?.name;
    if (!id || id === PROVIDER || id === 'enterprise-openai') continue;
    const cur = await get('llm-providers', id);
    if (cur.ok) await revokeAllKeys('llm-providers', id);
    const d = await req(`${base}/llm-providers/${encodeURIComponent(id)}`, {method:'DELETE'});
    if (!d.ok && d.status !== 404) throw new Error(`Deleting provider ${id} failed HTTP ${d.status}: ${d.text}`);
    console.log(`Deleted non-OpenAI provider ${id}.`);
  }
  // Known temporary resource from troubleshooting.
  const smoke = await get('llm-providers', 'helios-openai-smoke');
  if (smoke.ok) {
    await revokeAllKeys('llm-providers', 'helios-openai-smoke');
    await req(`${base}/llm-providers/helios-openai-smoke`, {method:'DELETE'});
    console.log('Deleted helios-openai-smoke.');
  }
}

const apiKeyPolicy = {
  name:'api-key-auth', version:'v1',
  paths:[{path:'/*', methods:['*'], params:{in:'header', key:PROVIDER_HEADER}}]
};

function providerPayload() {
  return {
    apiVersion:'gateway.api-platform.wso2.com/v1',
    kind:'LlmProvider',
    metadata:{name:PROVIDER},
    spec:{
      displayName:PROVIDER,
      version:'v1.0',
      template:'openai',
      context:`/${PROVIDER}`,
      upstream:{
        url:'https://api.openai.com/v1',
        auth:{type:'api-key', header:'Authorization', value:`Bearer ${openai}`}
      },
      accessControl:{mode:'allow_all'},
      policies:[apiKeyPolicy]
    }
  };
}

async function resetProvider() {
  const payload = providerPayload();
  const cur = await get('llm-providers', PROVIDER);
  if (cur.status === 404) {
    const c = await req(`${base}/llm-providers`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    });
    if (!c.ok) throw new Error(`Creating ${PROVIDER} failed HTTP ${c.status}: ${c.text}`);
    console.log(`Created ${PROVIDER}.`);
  } else if (cur.ok) {
    await revokeAllKeys('llm-providers', PROVIDER);
    const u = await req(`${base}/llm-providers/${encodeURIComponent(PROVIDER)}`, {
      method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    });
    if (!u.ok) throw new Error(`Updating ${PROVIDER} failed HTTP ${u.status}: ${u.text}`);
    console.log(`Reconfigured ${PROVIDER}; OpenAI credential retained from .openai.env.`);
  } else {
    throw new Error(`Provider lookup failed HTTP ${cur.status}: ${cur.text}`);
  }
  await waitDeployed('llm-providers', PROVIDER);
}

async function waitDeployed(kind, id) {
  let last;
  for (let i=0;i<60;i++) {
    last = await get(kind, id);
    if (last.ok && last.data?.status?.state === 'deployed') return last.data;
    await sleep(500);
  }
  throw new Error(`${kind}/${id} did not become deployed. Last response: ${last?.text}`);
}

async function generateKey(kind, id, name) {
  const r = await req(`${base}/${kind}/${encodeURIComponent(id)}/api-keys`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})
  });
  const key = r.data?.apiKey?.apiKey;
  if (!r.ok || typeof key !== 'string' || key.length < 16) {
    throw new Error(`Generating ${name} failed HTTP ${r.status}: ${r.text}`);
  }
  const fp = crypto.createHash('sha256').update(key).digest('hex').slice(0,12);
  console.log(`${name}: generated fresh key (${fp}).`);
  return key;
}

async function loadChain(file) {
  const chain = JSON.parse(await readFile(resolve(root, 'modular-ai-guardrails/config', file), 'utf8'));
  return chain.map(stage => ({
    ...stage,
    paths:(stage.paths || []).map(binding => ({
      ...binding,
      path: stage.name === 'api-key-auth' ? binding.path : '/chat/completions'
    }))
  }));
}

async function createProxy(id, context, chainFile, providerKey) {
  const chain = await loadChain(chainFile);
  const payload = {
    apiVersion:'gateway.api-platform.wso2.com/v1',
    kind:'LlmProxy',
    metadata:{name:id},
    spec:{
      displayName:id,
      version:'v1.0',
      context,
      provider:{id:PROVIDER, auth:{type:'api-key', header:PROVIDER_HEADER, value:providerKey}},
      policies:chain
    }
  };
  const c = await req(`${base}/llm-proxies`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
  });
  if (!c.ok) throw new Error(`Creating proxy ${id} failed HTTP ${c.status}: ${c.text}`);
  await waitDeployed('llm-proxies', id);
  console.log(`Created ${id} at ${context} with ${chain.length} policy stages.`);
}

const quote = v => `'${String(v).replace(/'/g, "'\\''")}'`;
async function writeEnv(path, env, header) {
  const lines = [header, ...Object.entries(env).map(([k,v]) => `${k}=${quote(v)}`)];
  await writeFile(path, lines.join('\n') + '\n');
  await chmod(path, 0o600);
}

async function writeRuntimeEnvs(providerKey, clinicalKey, patientKey) {
  const runtime = {
    LLM_MODE:'gateway',
    PORT:'5173',
    WSO2_AI_GATEWAY_URL:gatewayUrl,
    WSO2_PROVIDER_ID:PROVIDER,
    WSO2_TLS_INSECURE:'true',
    WSO2_API_KEY_HEADER:'X-API-Key',
    WSO2_DEFAULT_MODEL:model,
    WSO2_PROVIDER_ACCESS_KEY:providerKey,
    WSO2_CLINICAL_PROXY_API_KEY:clinicalKey,
    WSO2_PATIENT_PROXY_API_KEY:patientKey,
    WSO2_CLINICAL_PROXY_CONTEXT:CLINICAL_CONTEXT,
    WSO2_PATIENT_PROXY_CONTEXT:PATIENT_CONTEXT,
    WSO2_ADMIN_USER:user,
    WSO2_ADMIN_PASSWORD:pass,
    HELIOS_CONTEXT_SIGNING_KEY:process.env.HELIOS_CONTEXT_SIGNING_KEY || crypto.randomBytes(32).toString('hex'),
    HELIOS_PSEUDONYM_KEY:process.env.HELIOS_PSEUDONYM_KEY || crypto.randomBytes(32).toString('hex'),
    HELIOS_APPROVAL_KEY:process.env.HELIOS_APPROVAL_KEY || crypto.randomBytes(32).toString('hex'),
    HELIOS_KNOWLEDGE_SIGNING_KEY:process.env.HELIOS_KNOWLEDGE_SIGNING_KEY || crypto.randomBytes(32).toString('hex')
  };
  await writeEnv(resolve(root, '.helios.env'), runtime,
    '# Generated fresh by ./run.sh. Do not edit; it is replaced on every start.');
  await writeEnv(resolve(root, 'healthcare-ai-security-console/.env.local'), runtime,
    '# Mirror of root .helios.env for local console tooling. Replaced on every ./run.sh.');
  // Remove obsolete console .env so stale values can never shadow the generated config.
  await rm(resolve(root, 'healthcare-ai-security-console/.env'), {force:true});
}

console.log('==> Cleaning prior Helios LLM proxy/key state');
await purgeAllProxies();
await assertNoProxiesRemain();
await purgeNonOpenAIProviders();
await resetProvider();

// Never reuse an API-key name during a destructive reset. Controller -> runtime
// synchronization is asynchronous; deleting and immediately recreating a key
// with the same name can race with the old delete event and leave the freshly
// returned key unauthorized in the runtime. A unique name per run makes key
// rotation monotonic while the env variable names remain stable for clients.
const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const providerKey = await generateKey('llm-providers', PROVIDER, `helios-provider-${runId}`);
await createProxy(CLINICAL, CLINICAL_CONTEXT, 'clinical-policy-chain.json', providerKey);
await createProxy(PATIENT, PATIENT_CONTEXT, 'patient-support-policy-chain.json', providerKey);
const clinicalKey = await generateKey('llm-proxies', CLINICAL, `helios-clinical-${runId}`);
const patientKey = await generateKey('llm-proxies', PATIENT, `helios-patient-${runId}`);
await writeRuntimeEnvs(providerKey, clinicalKey, patientKey);

console.log('Fresh Helios Gateway application state created and runtime env files updated.');
console.log(`Provider: ${PROVIDER}`);
console.log(`Clinician proxy: ${CLINICAL_CONTEXT}/chat/completions`);
console.log(`Patient proxy: ${PATIENT_CONTEXT}/chat/completions`);
