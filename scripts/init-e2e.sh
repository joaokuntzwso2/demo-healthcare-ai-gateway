#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GW="$ROOT/wso2apip-ai-gateway-1.2.0"

for cmd in node python3 docker curl jq ap; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: missing required command: $cmd" >&2; exit 1; }
done

docker info >/dev/null 2>&1 || { echo 'ERROR: Docker is installed but the daemon is not running.' >&2; exit 1; }
[[ -d "$GW" ]] || { echo "ERROR: WSO2 AI Gateway 1.2.0 directory not found: $GW" >&2; exit 1; }
[[ -f "$GW/docker-compose.yaml" ]] || { echo "ERROR: missing $GW/docker-compose.yaml" >&2; exit 1; }
[[ -f "$GW/api-platform.env" ]] || {
  echo "ERROR: $GW/api-platform.env is missing. Run the one-time WSO2 1.2 setup first." >&2
  exit 1
}
[[ -f "$ROOT/.openai.env" ]] || { echo 'ERROR: .openai.env missing. Run ./run.sh.' >&2; exit 1; }

# Stop the console from the previous run so no process keeps stale environment values.
if [[ -f "$ROOT/.helios-console.pid" ]]; then
  pid="$(cat "$ROOT/.helios-console.pid" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  rm -f "$ROOT/.helios-console.pid"
fi

# Runtime/application state is deliberately regenerated on every start.
rm -f \
  "$ROOT/.helios.env" \
  "$ROOT/healthcare-ai-security-console/.env" \
  "$ROOT/healthcare-ai-security-console/.env.local" \
  "$ROOT/helios-console.log"

# Remove obsolete 1.1 runtime env state so it cannot accidentally be reused.
rm -f \
  "$ROOT/wso2apip-healthcare-ai-gateway-1.1.0/configs/keys.env" \
  "$ROOT/wso2apip-healthcare-ai-gateway-1.1.0/configs/workspace-secrets.env" 2>/dev/null || true

mkdir -p "$ROOT/evidence"

echo 'Helios preflight complete.'
echo 'Preserved: .openai.env and WSO2 1.2 Gateway registration/configuration.'
echo 'Removed: previous Helios runtime env, app keys, console process state, and legacy 1.1 env files.'
