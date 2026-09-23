#!/usr/bin/env bash
set -euo pipefail


# HELIOS_FHIR_PREFLIGHT_BEGIN
HELIOS_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELIOS_RUN_COMMAND="${1:-start}"

case "$HELIOS_RUN_COMMAND" in
  stop|clean|help|-h|--help)
    ;;
  *)
    if [[ "${HELIOS_SKIP_FHIR_PREFLIGHT:-false}" != "true" ]]; then
      command -v node >/dev/null 2>&1 || {
        echo "ERROR: node is required for the Helios FHIR interoperability adapter." >&2
        exit 1
      }

      printf '\n==> FHIR interoperability preflight\n'
      node "$HELIOS_REPO_ROOT/scripts/check-fhir.mjs"
    fi
    ;;
esac
# HELIOS_FHIR_PREFLIGHT_END

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENAI_ENV="$ROOT/.openai.env"

quote_shell() {
  local v="$1"
  printf "'%s'" "${v//\'/\'\\\'\'}"
}

save_openai_config() {
  : "${OPENAI_API_KEY:?OPENAI_API_KEY is required}"
  local model="${OPENAI_MODEL:-gpt-4o-mini}"
  umask 077
  {
    printf '# Persistent Helios OpenAI configuration. This is the only application secret preserved across ./run.sh resets.\n'
    printf 'OPENAI_API_KEY='; quote_shell "$OPENAI_API_KEY"; printf '\n'
    printf 'OPENAI_MODEL='; quote_shell "$model"; printf '\n'
  } > "$OPENAI_ENV"
  chmod 600 "$OPENAI_ENV"
}

load_or_capture_openai_config() {
  if [[ -z "${OPENAI_API_KEY:-}" && -f "$OPENAI_ENV" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$OPENAI_ENV"
    set +a
  fi

  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    if [[ -t 0 ]]; then
      read -r -s -p 'OpenAI API key: ' OPENAI_API_KEY
      echo
      export OPENAI_API_KEY
    else
      echo 'ERROR: OPENAI_API_KEY is not configured and .openai.env does not exist.' >&2
      exit 1
    fi
  fi

  OPENAI_MODEL="${OPENAI_MODEL:-gpt-4o-mini}"
  export OPENAI_MODEL
  save_openai_config
}

cmd="${1:-start}"
case "$cmd" in
  start|e2e|fresh)
    load_or_capture_openai_config
    exec "$ROOT/scripts/run-e2e.sh"
    ;;
  configure-openai)
    if [[ -t 0 ]]; then
      read -r -s -p 'OpenAI API key: ' OPENAI_API_KEY
      echo
      export OPENAI_API_KEY
      OPENAI_MODEL="${OPENAI_MODEL:-gpt-4o-mini}"
      export OPENAI_MODEL
      save_openai_config
      echo "Saved OpenAI configuration to $OPENAI_ENV"
    else
      echo 'ERROR: configure-openai requires an interactive terminal.' >&2
      exit 1
    fi
    ;;
  deterministic)
    exec "$ROOT/scripts/first-run-local.sh"
    ;;
  check)
    [[ -f "$ROOT/.helios.env" ]] || { echo 'ERROR: run ./run.sh first.' >&2; exit 1; }
    set -a
    # shellcheck disable=SC1090
    source "$ROOT/.helios.env"
    set +a
    exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/gateway-acceptance-retry.sh"
    ;;
  status)
    echo '--- BFF/UI ---'
    curl -fsS http://localhost:5173/api/health 2>/dev/null || echo 'not healthy'
    echo; echo '--- Gateway controller ---'
    curl -fsS http://localhost:9094/api/admin/v1/health 2>/dev/null || echo 'not healthy'
    echo; echo '--- Gateway runtime ---'
    curl -fsS http://localhost:9901/ready 2>/dev/null || echo 'not ready'
    echo; echo '--- Containers ---'
    GW="$ROOT/wso2apip-ai-gateway-1.2.0"
    if [[ -d "$GW" ]]; then
      args=(-f docker-compose.yaml)
      [[ -f "$GW/docker-compose.helios.override.yaml" ]] && args+=(-f docker-compose.helios.override.yaml)
      (cd "$GW" && docker compose "${args[@]}" ps) || true
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
Usage: ./run.sh [start|fresh|e2e|configure-openai|deterministic|check|status|stop|test]

  start/fresh/e2e  Destructively reset Helios Gateway application state, preserving
                   only .openai.env and Gateway registration, then recreate provider
                   access, both proxies, all app keys, all Helios runtime secrets,
                   env files, run live acceptance, and start the UI/BFF.
  configure-openai Replace the persistent OpenAI configuration.
  deterministic    Offline deterministic mode; no external LLM.
  check            Re-run live Gateway acceptance with the current generated runtime env.
  status           Show BFF and Gateway state.
  stop             Stop UI/BFF and Gateway containers without deleting Gateway registration.
  test             Run local tests.
USAGE
    exit 2
    ;;
esac
