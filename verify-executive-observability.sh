#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd)"
if [[ "$ROOT" != *"/healthcare-ai-gateway-demo" ]]; then
  echo "ERROR: run from repository root." >&2
  exit 1
fi

BASE="${HELIOS_BASE_URL:-http://localhost:5173}"
PROM="${HELIOS_PROMETHEUS_URL:-http://localhost:19090}"
GRAFANA="${HELIOS_GRAFANA_URL:-http://localhost:3000}"

echo "==> Static verification"
(
  cd healthcare-ai-security-console
  npm test
  npm run build
)
git diff --check
echo "PASS: local tests, build and diff checks"

echo
echo "==> Checking Helios semantic metrics endpoint"
METRICS="$(curl -fsS "$BASE/metrics")"
METRICS="$METRICS" python3 - <<'PY'
import os
m=os.environ["METRICS"]
required=[
 "helios_ai_requests_total",
 "helios_ai_request_duration_seconds_bucket",
 "helios_ai_model_calls_total",
 "helios_ai_model_tokens_total",
 "helios_ai_tools_total",
 "helios_ai_grounding_total",
 "helios_ai_abstentions_total",
 "helios_ai_policy_interventions_total"
]
for x in required:
    assert x in m,x
for forbidden in ("pat-1001","Marcus Reed","HN-P-","patientId="):
    assert forbidden not in m,forbidden
print("PASS: Prometheus semantic metrics exposed without patient identity labels")
PY

echo
echo "==> Starting Prometheus + Grafana"
./scripts/start-observability.sh

echo
echo "==> Generating representative governed traffic"
node scripts/generate-observability-demo-traffic.mjs >/tmp/helios-observability-seed.json

sleep 4

echo
echo "==> Executive semantic snapshot"
SNAP="$(curl -fsS "$BASE/api/observability/executive")"
SNAP="$SNAP" python3 - <<'PY'
import os,json
s=json.loads(os.environ["SNAP"])
assert s["requests"]["total"]>=4,s
assert s["requests"]["allowed"]>=1,s
assert s["requests"]["blocked"]>=1,s
assert s["requests"]["abstained"]>=1,s
assert s["model"]["calls"]>=1,s
assert s["latencyMs"]["p95"]>=0,s
assert s["topTools"],s
assert s["topPolicyInterventions"],s
print("PASS: allowed/blocked/abstained, latency, model usage, tools and interventions are populated")
PY

echo
echo "==> Prometheus readiness + target health"
curl -fsS "$PROM/-/ready" >/dev/null
TARGETS="$(curl -fsS "$PROM/api/v1/targets")"
TARGETS="$TARGETS" python3 - <<'PY'
import os,json
j=json.loads(os.environ["TARGETS"])
active=j["data"]["activeTargets"]
byjob={}
for t in active:
    byjob.setdefault(t["labels"].get("job"),[]).append(t["health"])
required=["helios-bff","wso2-controller","wso2-policy-engine","wso2-router"]
for job in required:
    assert job in byjob,(job,byjob)
    assert "up" in byjob[job],(job,byjob[job])
print("PASS: Prometheus is scraping Helios BFF plus WSO2 controller, policy engine and router")
PY

echo
echo "==> Prometheus semantic query"
QUERY="$(python3 - <<'PY'
import urllib.parse
print(urllib.parse.quote('sum(helios_ai_requests_total)'))
PY
)"
PROMQ="$(curl -fsS "$PROM/api/v1/query?query=$QUERY")"
PROMQ="$PROMQ" python3 - <<'PY'
import os,json
j=json.loads(os.environ["PROMQ"])
assert j["status"]=="success",j
assert j["data"]["result"],j
assert float(j["data"]["result"][0]["value"][1])>=4,j
print("PASS: Prometheus stores live Helios AI governance telemetry")
PY

echo
echo "==> Grafana readiness + provisioned dashboard"
curl -fsS "$GRAFANA/api/health" >/dev/null
DASH="$(curl -fsS "$GRAFANA/api/dashboards/uid/helios-executive")"
DASH="$DASH" python3 - <<'PY'
import os,json
j=json.loads(os.environ["DASH"])
d=j["dashboard"]
assert d["uid"]=="helios-executive",d
titles={p.get("title") for p in d.get("panels",[])}
required={
 "Governed requests","Allowed","Blocked","Abstentions",
 "P95 end-to-end latency","Model tokens","Tools called",
 "Grounding outcomes","Policy interventions",
 "WSO2 guardrails / policy interventions"
}
assert required.issubset(titles),(required-titles)
print("PASS: Grafana executive dashboard is provisioned with required VP panels")
PY

echo
echo "==> WSO2 native metrics evidence"
for url in \
  http://localhost:9011/metrics \
  http://localhost:9003/metrics \
  http://localhost:9901/stats/prometheus
do
  curl -fsS "$url" >/dev/null
done
echo "PASS: native WSO2 controller, policy-engine and Envoy metrics endpoints are live"

echo
echo "ALL EXECUTIVE OBSERVABILITY CHECKS PASSED"
echo
echo "Grafana dashboard:"
echo "  http://localhost:3000/d/helios-executive/helios-clinical-ai-executive?orgId=1&refresh=5s&kiosk"
