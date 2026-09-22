#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENVFILE="$ROOT/.helios.env"
CONSOLE="$ROOT/healthcare-ai-security-console"
PIDFILE="$ROOT/.helios-console.pid"
LOGFILE="$ROOT/helios-console.log"
[[ -f "$ENVFILE" ]] || { echo "ERROR: $ENVFILE missing. Run ./run.sh first." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$ENVFILE"
set +a
export LLM_MODE=gateway
export NODE_ENV=production
export PORT="${PORT:-5173}"
: "${WSO2_PROVIDER_ACCESS_KEY:?Provider key missing}"
: "${WSO2_CLINICAL_PROXY_API_KEY:?Clinician proxy key missing}"
: "${WSO2_PATIENT_PROXY_API_KEY:?Patient proxy key missing}"
: "${WSO2_CLINICAL_PROXY_CONTEXT:?Clinician proxy context missing}"
: "${WSO2_PATIENT_PROXY_CONTEXT:?Patient proxy context missing}"
: "${HELIOS_CONTEXT_SIGNING_KEY:?Context signing key missing}"
if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  sleep 1
fi
cd "$CONSOLE"
npm run build
nohup node server/index.mjs >"$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"
for _ in {1..60}; do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "Helios E2E console/BFF is running: http://localhost:$PORT"
    echo "Log: $LOGFILE"
    exit 0
  fi
  sleep .25
done
echo 'ERROR: Helios BFF did not become healthy.' >&2
tail -120 "$LOGFILE" >&2 || true
exit 1
