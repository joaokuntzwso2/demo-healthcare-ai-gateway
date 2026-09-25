#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd)"
EXPECTED_SUFFIX="/healthcare-ai-gateway-demo"
if [[ "$ROOT" != *"$EXPECTED_SUFFIX" ]]; then
  echo "ERROR: run this script from the healthcare-ai-gateway-demo repository root."
  exit 1
fi

BASE_URL="${HELIOS_BASE_URL:-http://localhost:5173}"
json_get(){ curl -fsS "$1"; }
json_post(){ local url="$1"; local body="$2"; curl -fsS -H 'content-type: application/json' -d "$body" "$url"; }

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
echo "==> Resetting professional-role audit"
json_post "$BASE_URL/api/demo/role-based-differences" '{"action":"reset"}' >/dev/null
echo "PASS: role audit reset"

echo
echo "==> Same-patient / same-question professional responsibility matrix"
SUMMARY="$(json_get "$BASE_URL/api/demo/role-based-differences")"
SUMMARY_JSON="$SUMMARY" python3 - <<'PY'
import json, os
s=json.loads(os.environ["SUMMARY_JSON"])
assert s["invariant"]["samePatient"] is True, s
assert s["invariant"]["sameTenant"] is True, s
assert s["invariant"]["samePurpose"] is True, s
assert s["invariant"]["sameQuestion"] is True, s
assert s["invariant"]["purpose"]=="medication-review", s
roles={x["actor"]["professionalRole"]["family"]:x for x in s["roles"]}
assert set(roles)=={"physician","pharmacist","nurse","care-manager"}, roles

p=roles["physician"]["capabilityMatrix"]
assert p["labs"] and p["medications"] and p["medicationOrderRequest"] and p["testOrderRequest"], p

p=roles["pharmacist"]["capabilityMatrix"]
assert p["labs"] and p["medications"] and p["medicationSafety"], p
assert not p["medicationOrderRequest"] and not p["clinicianApproval"], p

p=roles["nurse"]["capabilityMatrix"]
assert p["clinicalSummary"] and p["labs"] and p["allergies"] and p["noteDrafting"], p
assert not p["medications"] and not p["medicationOrderRequest"], p

p=roles["care-manager"]["capabilityMatrix"]
assert p["clinicalSummary"] and p["noteDrafting"], p
assert not p["labs"] and not p["medications"] and not p["medicationOrderRequest"], p
print("PASS: same patient/question produces four distinct professional capability surfaces")
PY

for actor in neph-001 pharm-001 nurse-001 care-001; do
  echo
  echo "==> Deterministic policy evaluation for $actor"
  VALUE="$(json_post "$BASE_URL/api/demo/role-based-differences" "{\"action\":\"evaluate\",\"actorId\":\"$actor\"}")"
  VALUE_JSON="$VALUE" ACTOR="$actor" python3 - <<'PY'
import json, os
r=json.loads(os.environ["VALUE_JSON"])
assert r["actor"]["id"]==os.environ["ACTOR"], r
assert r["question"], r
assert isinstance(r["modelWouldReceiveTools"],list), r
assert r["actor"]["professionalRole"]["policy"]=="PROFESSIONAL_ROLE_LEAST_PRIVILEGE", r
print(f"PASS: {os.environ['ACTOR']} model-visible tool surface is role/scopes/purpose bounded")
PY
done

echo
echo "==> Care manager same-question pre-model denial"
CARE="$(json_post "$BASE_URL/api/demo/role-based-differences" '{"action":"ask","actorId":"care-001"}')"
CARE_JSON="$CARE" python3 - <<'PY'
import json, os
x=json.loads(os.environ["CARE_JSON"])
r=x["result"]
assert r["decision"]=="BLOCKED", x
assert r["reasonCodes"]==["PROFESSIONAL_ROLE_CAPABILITY_DENIED"], x
assert r["agent"]["modelTurns"]==0, x
assert r["gateway"]["invoked"] is False, x
assert r["evidence"]==[], x
print("PASS: care manager question requiring lab evidence is denied before model/Gateway invocation")
PY

echo
echo "==> WSO2 independent professional-role denial probes"
for spec in \
  'pharm-001:draft_clinical_note' \
  'nurse-001:request_medication_order' \
  'care-001:get_recent_labs'
do
  ACTOR="${spec%%:*}"
  TOOL="${spec#*:}"
  VALUE="$(json_post "$BASE_URL/api/demo/role-based-differences/gateway-probe" "{\"actorId\":\"$ACTOR\"}")"
  VALUE_JSON="$VALUE" ACTOR="$ACTOR" TOOL="$TOOL" python3 - <<'PY'
import json, os
r=json.loads(os.environ["VALUE_JSON"])
assert r["decision"]=="BLOCKED_BY_GATEWAY", r
assert r["attemptedTool"]==os.environ["TOOL"], r
assert r["providerInvoked"] is False, r
assert r["gateway"]["status"]==422, r
assert r["guardrail"]["policy"]=="custom-tool-delegation-guard", r
assert r["guardrail"]["reasonCode"]=="PROFESSIONAL_ROLE_CAPABILITY_DENIED", r
print(f"PASS: WSO2 blocked {os.environ['ACTOR']} from {os.environ['TOOL']}")
PY
done

echo
echo "==> Professional-role audit minimization"
AUDIT="$(json_get "$BASE_URL/api/demo/role-based-differences/audit")"
AUDIT_JSON="$AUDIT" python3 - <<'PY'
import json, os
a=json.loads(os.environ["AUDIT_JSON"])
events=a.get("events",[])
assert events, a
serialized=json.dumps(events)
for forbidden in ("Potassium","Creatinine","Synthetic ACE","Marcus Reed"):
    assert forbidden not in serialized, (forbidden,events)
assert any(e.get("reasonCode")=="PROFESSIONAL_ROLE_CAPABILITY_DENIED" for e in events if e.get("type")=="PROFESSIONAL_ROLE_GATEWAY_PROBE"), events
print("PASS: role audit contains authorization decisions without copying clinical record content")
PY

echo
echo "ALL ROLE-BASED PROFESSIONAL DIFFERENCES CHECKS PASSED"
