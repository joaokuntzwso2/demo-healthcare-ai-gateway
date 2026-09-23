import {
  buildFhirEnvelope,
  FHIR_RELEASE,
  FHIR_VERSION
} from '../healthcare-ai-security-console/server/services/fhir-adapter.mjs';

function fail(message) {
  console.error(`ERROR: FHIR interoperability preflight failed: ${message}`);
  process.exit(1);
}

if (FHIR_RELEASE !== 'R4') {
  fail(`expected FHIR_RELEASE=R4, got ${FHIR_RELEASE}`);
}

if (FHIR_VERSION !== '4.0.1') {
  fail(`expected FHIR_VERSION=4.0.1, got ${FHIR_VERSION}`);
}

const context = {
  tenant: 'helios-preflight',
  patient: {
    id: 'preflight-internal-patient',
    pseudonym: 'FHIR-PREFLIGHT-PATIENT'
  }
};

const patient = {
  id: 'preflight-internal-patient',
  pseudonym: 'FHIR-PREFLIGHT-PATIENT'
};

const result = {
  source: 'LAB-SYSTEM',
  labs: [
    {
      id: 'preflight-observation',
      code: 'SYNTH-K',
      display: 'Potassium',
      value: 4.2,
      unit: 'mmol/L',
      observedAt: '2026-09-22T12:00:00Z',
      flag: 'normal-demo',
      source: 'LAB-SYSTEM'
    }
  ]
};

const envelope = buildFhirEnvelope({
  context,
  name: 'get_recent_labs',
  patient,
  result
});

if (!envelope) fail('buildFhirEnvelope returned no envelope');
if (envelope.release !== 'R4') fail(`unexpected envelope release ${envelope.release}`);
if (envelope.version !== '4.0.1') fail(`unexpected envelope version ${envelope.version}`);
if (envelope.bundle?.resourceType !== 'Bundle') fail('FHIR bundle is missing or is not a Bundle');

const types = (envelope.bundle.entry || [])
  .map(entry => entry?.resource?.resourceType)
  .filter(Boolean);

for (const required of ['Patient', 'Observation', 'Provenance']) {
  if (!types.includes(required)) fail(`required resource type ${required} is missing`);
}

const serialized = JSON.stringify(envelope);
if (serialized.includes('preflight-internal-patient')) {
  fail('raw internal patient identifier leaked into FHIR representation');
}

console.log(
  `OK: FHIR interoperability ready — ${FHIR_RELEASE} ${FHIR_VERSION} | ` +
  `${types.length} resources | ${[...new Set(types)].join(', ')}`
);
