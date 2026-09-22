#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cmd="${1:-start}"
case "$cmd" in
  start|e2e)
    if [[ -z "${OPENAI_API_KEY:-}" ]]; then
      if [[ -t 0 ]]; then
        read -r -s -p 'OpenAI API key (used only to configure the local WSO2 provider): ' OPENAI_API_KEY
        echo
        export OPENAI_API_KEY
      else
        echo 'ERROR: OPENAI_API_KEY is required for real end-to-end mode.' >&2
        exit 1
      fi
    fi
    exec "$ROOT/scripts/run-e2e.sh"
    ;;
  deterministic)
    exec "$ROOT/scripts/first-run-local.sh"
    ;;
  check)
    [[ -f "$ROOT/.helios.env" ]] || { echo 'ERROR: run ./run.sh first.' >&2; exit 1; }
    # shellcheck disable=SC1090
    source "$ROOT/.helios.env"
    export LLM_MODE WSO2_AI_GATEWAY_URL WSO2_PROVIDER_ACCESS_KEY WSO2_CLINICAL_PROXY_API_KEY WSO2_PATIENT_PROXY_API_KEY WSO2_TLS_INSECURE WSO2_API_KEY_HEADER WSO2_DEFAULT_MODEL HELIOS_CONTEXT_SIGNING_KEY HELIOS_PSEUDONYM_KEY HELIOS_APPROVAL_KEY HELIOS_KNOWLEDGE_SIGNING_KEY
    exec node "$ROOT/scripts/gateway-acceptance.mjs"
    ;;
  status)
    echo '--- BFF/UI ---'
    curl -fsS http://localhost:5173/api/health 2>/dev/null || echo 'not healthy'
    echo; echo '--- Gateway controller ---'
    curl -fsS http://localhost:9094/health 2>/dev/null || echo 'not healthy'
    echo; echo '--- Gateway runtime ---'
    curl -fsS http://localhost:9901/ready 2>/dev/null || echo 'not ready'
    echo; echo '--- Containers ---'
    GW="$ROOT/wso2apip-healthcare-ai-gateway-1.1.0"; KEYENV="$GW/configs/keys.env"
    if [[ -f "$KEYENV" ]]; then
      (cd "$GW" && docker compose -p helios-ai-gateway --env-file "$KEYENV" ps) || true
    else
      (cd "$GW" && docker compose -p helios-ai-gateway ps) || true
    fi
    ;;
  stop)
    exec "$ROOT/scripts/stop-e2e.sh"
    ;;
  test)
    exec "$ROOT/scripts/run-all-local-tests.sh"
    ;;
  *)
    cat <<USAGE
Usage: ./run.sh [start|e2e|deterministic|check|status|stop|test]

  start/e2e      Build/start custom WSO2 Gateway, deploy provider + two proxies,
                 apply policy chains, generate keys, live-test the model/tool loop,
                 and start the UI/BFF in gateway mode. Requires OPENAI_API_KEY.
  deterministic Offline deterministic test/demo mode; no external LLM.
  check          Re-run live Gateway + agent acceptance using saved proxy keys.
  status         Show BFF, Gateway controller/runtime, and container state.
  stop           Stop UI/BFF and Gateway containers (preserve controller volume).
  test           Run local Go/Node/build tests without needing OpenAI.
USAGE
    exit 2
    ;;
esac
