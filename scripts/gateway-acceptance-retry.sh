#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACCEPTANCE="$ROOT_DIR/scripts/gateway-acceptance.mjs"

if [[ -f "$ROOT_DIR/.helios.env" ]]; then
  set -a
  source "$ROOT_DIR/.helios.env"
  set +a
fi

export LLM_MODE=gateway
export WSO2_AI_GATEWAY_URL="${WSO2_AI_GATEWAY_URL:-https://localhost:18443}"
export WSO2_TLS_INSECURE="${WSO2_TLS_INSECURE:-true}"
export WSO2_API_KEY_HEADER="${WSO2_API_KEY_HEADER:-X-API-Key}"
export WSO2_DEFAULT_MODEL="${WSO2_DEFAULT_MODEL:-gpt-4o-mini}"

required_env=(
  WSO2_CLINICAL_PROXY_API_KEY
  WSO2_PATIENT_PROXY_API_KEY
  HELIOS_CONTEXT_SIGNING_KEY
)

for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name is missing. Run ./run.sh once to regenerate .helios.env." >&2
    exit 1
  fi
done

MAX_ATTEMPTS="${HELIOS_ACCEPTANCE_MAX_ATTEMPTS:-4}"
SLEEP_SECONDS="${HELIOS_ACCEPTANCE_RETRY_SECONDS:-4}"

is_transient() {
  grep -Eqi \
    'GATEWAY_HTTP_(502|503|504)|HTTP (502|503|504)|upstream connect error|connection timeout|disconnect/reset before headers|ECONNRESET|ETIMEDOUT|socket hang up|temporarily unavailable' \
    "$1"
}

attempt=1
while (( attempt <= MAX_ATTEMPTS )); do
  tmp="${TMPDIR:-/tmp}/helios-gateway-acceptance-${$}-${attempt}.log"

  echo
  echo "==> Model-driven Gateway acceptance attempt ${attempt}/${MAX_ATTEMPTS}"

  (
    cd "$ROOT_DIR"
    node "$ACCEPTANCE"
  ) >"$tmp" 2>&1
  rc=$?

  cat "$tmp"

  if [[ $rc -eq 0 ]]; then
    rm -f "$tmp"
    if (( attempt > 1 )); then
      echo "PASS: model-driven acceptance recovered after transient upstream failure."
    fi
    exit 0
  fi

  if ! is_transient "$tmp"; then
    echo "ERROR: Gateway acceptance failed with a non-transient regression; not retrying." >&2
    rm -f "$tmp"
    exit "$rc"
  fi

  if (( attempt == MAX_ATTEMPTS )); then
    echo "ERROR: Gateway acceptance still has transient upstream failures after ${MAX_ATTEMPTS} attempts." >&2
    rm -f "$tmp"
    exit "$rc"
  fi

  echo "WARN: transient upstream failure detected; retrying after ${SLEEP_SECONDS}s..." >&2
  rm -f "$tmp"
  sleep "$SLEEP_SECONDS"
  attempt=$((attempt+1))
done
