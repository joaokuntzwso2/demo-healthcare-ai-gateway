#!/usr/bin/env bash
set -euo pipefail
PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_HOME="${DEMO_HOME:-$(cd "$PACKAGE_ROOT/.." && pwd)}"
GATEWAY_HOME="${GATEWAY_HOME:-$DEMO_HOME/wso2apip-healthcare-ai-gateway-1.1.0}"
KEYENV="$GATEWAY_HOME/configs/keys.env"
CONTROLLER_ADMIN_URL="${CONTROLLER_ADMIN_URL:-http://localhost:9094/health}"
RUNTIME_ADMIN_URL="${RUNTIME_ADMIN_URL:-http://localhost:9901/ready}"
READY_ATTEMPTS="${READY_ATTEMPTS:-90}"
READY_INTERVAL_SECONDS="${READY_INTERVAL_SECONDS:-2}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEMO_HOME/evidence"

command -v ap >/dev/null || { echo 'ERROR: ap CLI is required.' >&2; exit 1; }
command -v docker >/dev/null || { echo 'ERROR: Docker is required.' >&2; exit 1; }
[[ -f "$KEYENV" ]] || { echo "ERROR: $KEYENV missing. Run scripts/init-e2e.sh first." >&2; exit 1; }

# Preserve parity with the canonical banking Gateway build. The custom image
# must retain WSO2's standard policies used by Provider/Proxy transformations
# in addition to the 22 Helios custom modules.
for required_policy in api-key-auth host-rewrite request-rewrite respond set-headers subscription-validation; do
  grep -q "name: ${required_policy}$" "$GATEWAY_HOME/build.yaml" || {
    echo "ERROR: build.yaml is missing required WSO2 policy: ${required_policy}" >&2
    exit 1
  }
done

"$PACKAGE_ROOT/scripts/test-modular-policies.sh"
cd "$GATEWAY_HOME"
BUILD_LOG="$DEMO_HOME/evidence/gateway-build-$STAMP.log"
echo "==> Building custom WSO2 AI Gateway images (full WSO2 built-ins + 22 Helios custom modules)"
set -o pipefail
ap gateway image build --name healthcare-ai-security-gateway 2>&1 | tee "$BUILD_LOG"

# Resolve the exact custom image tags printed by the CLI. Fall back to local Docker image inventory.
controller_image="$(grep -Eo '[^[:space:]•]+-gateway-controller:[^[:space:]]+' "$BUILD_LOG" | tail -1 || true)"
runtime_image="$(grep -Eo '[^[:space:]•]+-gateway-runtime:[^[:space:]]+' "$BUILD_LOG" | tail -1 || true)"
if [[ -z "$controller_image" ]]; then
  controller_image="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E 'healthcare-ai-security-gateway.*-gateway-controller:' | head -1 || true)"
fi
if [[ -z "$runtime_image" ]]; then
  runtime_image="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E 'healthcare-ai-security-gateway.*-gateway-runtime:' | head -1 || true)"
fi
[[ -n "$controller_image" && -n "$runtime_image" ]] || {
  echo 'ERROR: custom image build completed but image tags could not be resolved.' >&2
  echo "Inspect: $BUILD_LOG" >&2
  exit 1
}

python3 - "$KEYENV" "$controller_image" "$runtime_image" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); updates={'GATEWAY_CONTROLLER_IMAGE':sys.argv[2],'GATEWAY_RUNTIME_IMAGE':sys.argv[3]}
rows=[]; seen=set()
for line in p.read_text().splitlines() if p.exists() else []:
    if '=' in line and not line.lstrip().startswith('#'):
        k=line.split('=',1)[0].strip()
        if k in updates:
            rows.append(f'{k}={updates[k]}'); seen.add(k); continue
    rows.append(line)
for k,v in updates.items():
    if k not in seen: rows.append(f'{k}={v}')
p.write_text('\n'.join(rows)+'\n'); p.chmod(0o600)
PY

echo "==> Starting custom WSO2 AI Gateway"
docker compose -p helios-ai-gateway --env-file "$KEYENV" up -d --force-recreate --remove-orphans --pull never

printf 'Waiting for Gateway Controller and Runtime'
controller_ready=false; runtime_ready=false
for ((attempt=1; attempt<=READY_ATTEMPTS; attempt++)); do
  if [[ "$controller_ready" != true ]] && curl -fsS --max-time 3 "$CONTROLLER_ADMIN_URL" >/dev/null 2>&1; then controller_ready=true; fi
  if [[ "$runtime_ready" != true ]] && curl -fsS --max-time 3 "$RUNTIME_ADMIN_URL" >/dev/null 2>&1; then runtime_ready=true; fi
  if [[ "$controller_ready" == true && "$runtime_ready" == true ]]; then printf ' ready\n'; break; fi
  printf '.'; sleep "$READY_INTERVAL_SECONDS"
done
if [[ "$controller_ready" != true || "$runtime_ready" != true ]]; then
  printf '\nERROR: Gateway readiness failed (controller=%s runtime=%s).\n' "$controller_ready" "$runtime_ready" >&2
  docker compose -p helios-ai-gateway --env-file "$KEYENV" ps -a >&2 || true
  docker compose -p helios-ai-gateway --env-file "$KEYENV" logs --tail=160 --no-color gateway-controller gateway-runtime >&2 || true
  exit 1
fi

echo "Custom controller image: $controller_image"
echo "Custom runtime image:    $runtime_image"
docker compose -p helios-ai-gateway --env-file "$KEYENV" ps
