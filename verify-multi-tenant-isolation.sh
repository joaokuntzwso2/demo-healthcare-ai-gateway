#!/usr/bin/env bash
set -euo pipefail
ROOT="$(pwd)"; [[ "$ROOT" == */healthcare-ai-gateway-demo ]] || { echo "ERROR: run from repo root"; exit 1; }
BASE="${HELIOS_BASE_URL:-http://localhost:5173}"
get(){ curl -fsS "$1"; }
post(){ curl -fsS -H 'content-type: application/json' -d "$2" "$1"; }

echo "==> Static verification"
(cd healthcare-ai-security-console && npm test && npm run build)
./modular-ai-guardrails/scripts/test-modular-policies.sh
git diff --check

echo "==> Running API"
get "$BASE/api/health" >/dev/null
post "$BASE/api/demo/tenant-isolation" '{"action":"reset"}' >/dev/null

S="$(get "$BASE/api/demo/tenant-isolation")"; SUMMARY="$S" python3 - <<'PY'
import json,os
s=json.loads(os.environ['SUMMARY']);assert s['actor']['id']=='endo-001';assert s['actor']['tenant']=='helios-north';assert s['identifier']['value']=='MRN-04217';assert s['identifier']['scope']=='TENANT';assert s['identifier']['collisionCount']==2;assert s['policy']['foreignIdentifierLookupBeforeTenantCheck'] is False;assert s['policy']['crossTenantBreakGlassAllowed'] is False;print('PASS duplicated MRN is explicitly tenant scoped')
PY

L="$(post "$BASE/api/demo/tenant-isolation" '{"action":"resolve","actorId":"endo-001","targetTenant":"helios-north","value":"MRN-04217"}')"; LOCAL="$L" python3 - <<'PY'
import json,os
r=json.loads(os.environ['LOCAL']);assert r['decision']=='ALLOWED';assert r['patient']['id']=='pat-1004';assert r['patient']['tenant']=='helios-north';assert r['patientResolved'] is True;assert r['clinicalDataReleased'] is False;print('PASS Mateo resolves MRN only inside Helios North')
PY

F="$(post "$BASE/api/demo/tenant-isolation" '{"action":"resolve","actorId":"endo-001","targetTenant":"aurora-br","value":"MRN-04217"}')"; FOREIGN="$F" python3 - <<'PY'
import json,os
r=json.loads(os.environ['FOREIGN']);assert r['decision']=='BLOCKED';assert r['reasonCodes']==['TENANT_BOUNDARY_VIOLATION'];assert r['patientResolved'] is False;assert r['clinicalDataReleased'] is False;assert r['modelInvoked'] is False;assert r['gatewayInvoked'] is False;j=json.dumps(r);assert all(x not in j for x in ['Carlos Ferreira','pat-br-2001','AS-P-A81C09']);print('PASS Aurora attempt stops before foreign patient resolution/model/data release')
PY

G="$(post "$BASE/api/demo/tenant-isolation/gateway-probe" '{}')"; GATEWAY="$G" python3 - <<'PY'
import json,os
r=json.loads(os.environ['GATEWAY']);assert r['decision']=='BLOCKED_BY_GATEWAY';assert r['providerInvoked'] is False;assert r['gateway']['status']==422;assert r['guardrail']['policy']=='custom-tenant-workforce-context-guard';assert r['guardrail']['reasonCode']=='TENANT_BOUNDARY_VIOLATION';print('PASS WSO2 independently blocks Helios North -> Aurora Saúde')
PY

A="$(get "$BASE/api/demo/tenant-isolation/audit?actorId=endo-001")"; AUDIT="$A" python3 - <<'PY'
import json,os,re
e=json.loads(os.environ['AUDIT'])['events'];assert e;j=json.dumps(e);assert all(x not in j for x in ['MRN-04217','Carlos Ferreira','pat-br-2001','AS-P-A81C09']);hs=[x.get('identifierHash') for x in e if x.get('identifierHash')];assert hs and all(re.fullmatch(r'MRN-HASH-[A-F0-9]{16}',x) for x in hs);assert any(x.get('reasonCode')=='TENANT_BOUNDARY_VIOLATION' for x in e);print('PASS audit is minimized and contains tenant denial evidence')
PY

echo "ALL MULTI-HOSPITAL / TENANT ISOLATION CHECKS PASSED"
