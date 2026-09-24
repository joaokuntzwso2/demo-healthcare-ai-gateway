#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd)"
CONSOLE="$ROOT/healthcare-ai-security-console"
POLICY_DIR="$ROOT/modular-ai-guardrails/policies/custom-sensitive-clinical-context-guard"
BASE_URL="${HELIOS_UI_URL:-http://localhost:5173}"

[[ -f "$CONSOLE/package.json" ]] || { echo "ERROR: run from demo-healthcare-ai-gateway repository root." >&2; exit 1; }

say(){ printf '\n==> %s\n' "$*"; }
pass(){ printf 'PASS: %s\n' "$*"; }

say "Static verification"
node --check "$CONSOLE/server/services/restricted-clinical-information.mjs"
node --check "$CONSOLE/server/services/context.mjs"
node --check "$CONSOLE/server/services/gateway-client.mjs"
node --check "$CONSOLE/server/services/tools.mjs"
node --check "$CONSOLE/server/services/tool-schemas.mjs"
node --check "$CONSOLE/server/services/copilot.mjs"
node --check "$CONSOLE/server/services/demo-catalog.mjs"
node --check "$CONSOLE/server/index.mjs"
node --check "$CONSOLE/public/app.js"
(
  cd "$CONSOLE"
  npm test
  npm run build
)
if command -v go >/dev/null 2>&1; then
  (cd "$POLICY_DIR" && go test ./...)
else
  echo "WARN: Go not installed; Gateway policy unit test skipped." >&2
fi
git diff --check
pass "local syntax, tests, build and diff checks"

say "Checking running Helios console"
if ! curl -fsS "$BASE_URL/api/health" >/dev/null; then
  cat >&2 <<MSG
ERROR: Helios is not reachable at $BASE_URL.
Start the updated stack first with:
  HELIOS_FORCE_GATEWAY_BUILD=true ./run.sh
Then run this verifier again.
MSG
  exit 1
fi
pass "Helios API reachable"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

post_json(){
  local path="$1" payload="$2" out="$3"
  curl -fsS -X POST "$BASE_URL$path" \
    -H 'content-type: application/json' \
    --data "$payload" > "$out"
}

assert_json(){
  local file="$1" js="$2" label="$3"
  node - "$file" "$js" "$label" <<'NODE'
const fs=require('fs');
const [file,expr,label]=process.argv.slice(2);
const j=JSON.parse(fs.readFileSync(file,'utf8'));
let ok=false;
try{ ok=Boolean(Function('j',`return (${expr})`)(j)); }catch(e){ console.error(e); }
if(!ok){
  console.error(`FAIL: ${label}`);
  console.error(JSON.stringify(j,null,2));
  process.exit(1);
}
console.log(`PASS: ${label}`);
NODE
}

say "Resetting restricted authorization fixture"
post_json "/api/demo/restricted-clinical-information" '{"action":"reset"}' "$TMP/reset.json"
assert_json "$TMP/reset.json" \
  "j.authorization?.active===true && j.ordinaryClinician?.restrictedAuthorization?.ordinaryChartAccess===true && j.ordinaryClinician?.restrictedAuthorization?.active===false && j.restrictedClinician?.restrictedAuthorization?.active===true" \
  "fixture starts with ordinary chart access separated from active restricted authorization"

PROMPT="Summarize Nadia Rahman's restricted behavioral-health follow-up record using only authorized evidence."

say "Application/BFF negative path — Dr. Mateo has ordinary chart access but no restricted authorization"
post_json "/api/copilot" "$(node -e 'process.stdout.write(JSON.stringify({query:process.argv[1],actorId:"endo-001",patientId:"pat-1004",encounterId:null,purpose:"behavioral-health-treatment"}))' "$PROMPT")" "$TMP/mateo.json"
assert_json "$TMP/mateo.json" \
  "j.decision==='BLOCKED' && Array.isArray(j.reasonCodes) && j.reasonCodes.includes('RESTRICTED_RECORD_ACCESS_DENIED') && j.agent?.modelTurns===0 && j.gateway?.invoked===false && (j.evidence||[]).length===0" \
  "unauthorized restricted request stops before model/Gateway and releases no evidence"

say "Authorized path — Dr. Hannah Lee has restricted scope + patient authorization + correct purpose"
post_json "/api/copilot" "$(node -e 'process.stdout.write(JSON.stringify({query:process.argv[1],actorId:"bh-001",patientId:"pat-1004",encounterId:null,purpose:"behavioral-health-treatment"}))' "$PROMPT")" "$TMP/hannah.json"
assert_json "$TMP/hannah.json" \
  "j.decision==='ALLOWED' && (j.agent?.toolExecutions||[]).some(x=>x.name==='get_restricted_clinical_information') && (j.evidence||[]).some(x=>x.evidenceType==='AUTHORITATIVE RESTRICTED PATIENT FACT')" \
  "authorized specialist retrieves restricted evidence through the governed tool"

say "Revocation path — same specialist loses access immediately"
post_json "/api/demo/restricted-clinical-information" '{"action":"revoke"}' "$TMP/revoke.json"
post_json "/api/copilot" "$(node -e 'process.stdout.write(JSON.stringify({query:process.argv[1],actorId:"bh-001",patientId:"pat-1004",encounterId:null,purpose:"behavioral-health-treatment"}))' "$PROMPT")" "$TMP/revoked.json"
assert_json "$TMP/revoked.json" \
  "j.decision==='BLOCKED' && j.reasonCodes?.includes('RESTRICTED_RECORD_ACCESS_DENIED') && j.agent?.modelTurns===0 && j.gateway?.invoked===false" \
  "revoked patient authorization blocks the previously authorized specialist before model invocation"

say "Restoring authorization"
post_json "/api/demo/restricted-clinical-information" '{"action":"restore"}' "$TMP/restore.json"
assert_json "$TMP/restore.json" "j.authorization?.active===true" "patient authorization restored"

say "Direct WSO2 AI Gateway probe — bypass application preflight but preserve signed context"
post_json "/api/demo/guardrail-probe" "$(node -e 'process.stdout.write(JSON.stringify({app:"clinician",prompt:process.argv[1],actorId:"endo-001",patientId:"pat-1004",encounterId:null,purpose:"behavioral-health-treatment"}))' "$PROMPT")" "$TMP/gateway.json"
assert_json "$TMP/gateway.json" \
  "j.decision==='BLOCKED_BY_GATEWAY' && j.guardrail?.policy==='custom-sensitive-clinical-context-guard' && j.guardrail?.reasonCode==='RESTRICTED_RECORD_ACCESS_DENIED'" \
  "WSO2 Gateway independently blocks ordinary-chart access to the restricted segment"

say "Audit minimization"
curl -fsS "$BASE_URL/api/demo/restricted-clinical-information/audit?patientId=pat-1004" > "$TMP/audit.json"
assert_json "$TMP/audit.json" \
  "Array.isArray(j.events) && j.events.length>0 && !JSON.stringify(j).includes('Synthetic behavioral-health follow-up record') && !JSON.stringify(j).includes('Continue clinician-directed behavioral-health follow-up')" \
  "restricted audit contains decision metadata without copying the restricted record body"

printf '\nALL RESTRICTED CLINICAL INFORMATION CHECKS PASSED\n'
