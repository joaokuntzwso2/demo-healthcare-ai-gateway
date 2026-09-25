#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd)"
EXPECTED_SUFFIX="/healthcare-ai-gateway-demo"

if [[ "$ROOT" != *"$EXPECTED_SUFFIX" ]]; then
  echo "ERROR: run this script from the healthcare-ai-gateway-demo repository root."
  exit 1
fi

BASE_URL="${HELIOS_BASE_URL:-http://localhost:5173}"

json_get(){
  curl -fsS "$1"
}

json_post(){
  local url="$1"
  local body="$2"
  curl -fsS \
    -H 'content-type: application/json' \
    -d "$body" \
    "$url"
}

echo "==> Static verification"
(
  cd healthcare-ai-security-console
  npm test
  npm run build
)

./modular-ai-guardrails/scripts/test-modular-policies.sh
git diff --check

echo "PASS: local tests, frontend build, policy tests and diff checks"

echo
echo "==> Checking running Helios console"
json_get "$BASE_URL/api/health" >/dev/null
echo "PASS: Helios API reachable"

echo
echo "==> Resetting clinical knowledge lifecycle"
json_post \
  "$BASE_URL/api/demo/clinical-knowledge-lifecycle" \
  '{"action":"reset"}' \
  >/dev/null
echo "PASS: knowledge lifecycle fixture reset"

echo
echo "==> Inspecting lifecycle/trust/provenance matrix"
SUMMARY="$(json_get "$BASE_URL/api/demo/clinical-knowledge-lifecycle")"

SUMMARY_JSON="$SUMMARY" python3 - <<'PY'
import json
import os
import re

s=json.loads(os.environ["SUMMARY_JSON"])

active=s["sources"]["active"]
stale=s["sources"]["stale"]
referral=s["sources"]["maliciousReferral"]

assert active["version"]=="3.0", active
assert active["lifecycleState"]=="ACTIVE", active
assert active["trustClassification"]=="TRUSTED_GOVERNED", active
assert active["eligibleForRetrieval"] is True, active
assert active["provenance"]["signatureState"]=="valid-demo-hmac", active
assert active["provenance"]["knowledgeProofState"]=="signed-hmac-sha256", active
assert re.fullmatch(r"[A-Za-z0-9_-]+\.[a-f0-9]{64}",active["provenance"]["knowledgeProof"]), active
assert re.fullmatch(r"[a-f0-9]{64}",active["provenance"]["sha256"]), active
assert active["provenance"]["supersedes"]=="2.0", active

assert stale["version"]=="2.0", stale
assert stale["lifecycleState"]=="STALE", stale
assert stale["trustClassification"]=="TRUSTED_GOVERNED", stale
assert stale["eligibleForRetrieval"] is False, stale
assert stale["provenance"]["supersededBy"]=="3.0", stale
assert (
    "STALE_SOURCE" in stale["reasonCodes"] or
    "SUPERSEDED_VERSION" in stale["reasonCodes"]
), stale

assert referral["lifecycleState"]=="QUARANTINED", referral
assert referral["trustClassification"]=="UNTRUSTED_EXTERNAL_EVIDENCE", referral
assert referral["eligibleForRetrieval"] is False, referral
assert "INDIRECT_PROMPT_INJECTION" in referral["reasonCodes"], referral
assert referral["contentPreview"]=="[QUARANTINED CONTENT NOT EXPOSED]", referral

serialized=json.dumps(s)

assert "IGNORE PRIOR INSTRUCTIONS" not in serialized, serialized
assert "maximum dose" not in serialized.lower(), serialized

print(
    "PASS: v3 active; v2 stale/superseded; malicious referral "
    "quarantined with provenance and trust classification"
)
PY

echo
echo "==> Governed retrieval must return active v3 and exclude stale v2"

RETRIEVE="$(json_post \
  "$BASE_URL/api/demo/clinical-knowledge-lifecycle" \
  '{"action":"retrieve-active"}')"

RETRIEVE_JSON="$RETRIEVE" python3 - <<'PY'
import json
import os

r=json.loads(os.environ["RETRIEVE_JSON"])

assert r["decision"]=="ACTIVE_GUIDELINE_RETRIEVED", r
assert r["activeGuideline"]["version"]=="3.0", r
assert r["activeGuideline"]["lifecycleState"]=="ACTIVE", r
assert r["activeGuideline"]["trustClassification"]=="TRUSTED_GOVERNED", r
assert r["activeGuideline"]["eligibleForRetrieval"] is True, r
assert r["activeGuideline"]["provenance"]["knowledgeProofState"]=="signed-hmac-sha256", r
assert r["staleGuidelineReturned"] is False, r
assert not any(x.get("version")=="2.0" for x in r["sources"]), r

print(
    "PASS: retrieval returns active trusted v3 and excludes stale v2"
)
PY

echo
echo "==> WSO2 must accept active trusted governed knowledge"

ACTIVE_GATEWAY="$(json_post \
  "$BASE_URL/api/demo/clinical-knowledge-lifecycle" \
  '{"action":"gateway-probe","kind":"active"}')"

ACTIVE_GATEWAY_JSON="$ACTIVE_GATEWAY" python3 - <<'PY'
import json
import os

r=json.loads(os.environ["ACTIVE_GATEWAY_JSON"])

assert r["decision"]=="ALLOWED", r
assert 200 <= r["gateway"]["status"] < 300, r
assert r["providerInvoked"] is True, r
assert r["source"]["version"]=="3.0", r
assert r["source"]["lifecycleState"]=="ACTIVE", r
assert r["source"]["trustClassification"]=="TRUSTED_GOVERNED", r

print(
    "PASS: WSO2 accepts active trusted governed v3 knowledge"
)
PY

echo
echo "==> WSO2 must independently reject stale clinical knowledge"

STALE="$(json_post \
  "$BASE_URL/api/demo/clinical-knowledge-lifecycle" \
  '{"action":"gateway-probe","kind":"stale"}')"

STALE_JSON="$STALE" python3 - <<'PY'
import json
import os

r=json.loads(os.environ["STALE_JSON"])

assert r["decision"]=="BLOCKED_BY_GATEWAY", r
assert r["gateway"]["status"]==422, r
assert r["providerInvoked"] is False, r
assert r["guardrail"]["policy"]=="custom-trusted-clinical-source-guard", r
assert r["guardrail"]["reasonCode"]=="CLINICAL_KNOWLEDGE_NOT_ACTIVE", r

print(
    "PASS: WSO2 independently blocks stale/superseded v2 knowledge"
)
PY

echo
echo "==> WSO2 must independently block malicious referral instructions"

REFERRAL="$(json_post \
  "$BASE_URL/api/demo/clinical-knowledge-lifecycle" \
  '{"action":"gateway-probe","kind":"malicious-referral"}')"

REFERRAL_JSON="$REFERRAL" python3 - <<'PY'
import json
import os

r=json.loads(os.environ["REFERRAL_JSON"])

assert r["decision"]=="BLOCKED_BY_GATEWAY", r
assert r["gateway"]["status"]==422, r
assert r["providerInvoked"] is False, r
assert r["guardrail"]["policy"]=="custom-clinical-note-injection-guard", r
assert r["guardrail"]["reasonCode"]=="INDIRECT_PROMPT_INJECTION", r

print(
    "PASS: WSO2 independently blocks model-directed instructions "
    "in the uploaded referral"
)
PY

echo
echo "==> Knowledge lifecycle audit minimization"

AUDIT="$(json_get \
  "$BASE_URL/api/demo/clinical-knowledge-lifecycle/audit")"

AUDIT_JSON="$AUDIT" python3 - <<'PY'
import json
import os

a=json.loads(os.environ["AUDIT_JSON"])
events=a.get("events",[])

assert events, a

serialized=json.dumps(events).lower()

for forbidden in (
    "ignore prior instructions",
    "maximum dose",
    "current renal function must be reviewed",
):
    assert forbidden not in serialized, (forbidden,events)

assert any(
    e.get("type")=="KNOWLEDGE_RETRIEVAL_DECISION"
    for e in events
), events

assert any(
    e.get("type")=="KNOWLEDGE_GATEWAY_PROBE" and
    e.get("probe")=="stale"
    for e in events
), events

assert any(
    e.get("type")=="KNOWLEDGE_GATEWAY_PROBE" and
    e.get("probe")=="malicious-referral"
    for e in events
), events

print(
    "PASS: lifecycle audit stores governance decisions without "
    "copying clinical/document bodies"
)
PY

echo
echo "ALL CLINICAL KNOWLEDGE LIFECYCLE CHECKS PASSED"
