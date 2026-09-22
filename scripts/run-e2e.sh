#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GW="$ROOT/wso2apip-ai-gateway-1.2.0"

set -a
# shellcheck disable=SC1090
source "$ROOT/.openai.env"
set +a
: "${OPENAI_API_KEY:?OPENAI_API_KEY is required in .openai.env}"

# Generate all disposable Helios runtime secrets once per startup, before the
# Gateway container starts. The context signing key must be identical in the
# BFF and the custom Go policies running inside gateway-runtime.
rand_hex_32(){ node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"; }
export HELIOS_CONTEXT_SIGNING_KEY="$(rand_hex_32)"
export HELIOS_PSEUDONYM_KEY="$(rand_hex_32)"
export HELIOS_APPROVAL_KEY="$(rand_hex_32)"
export HELIOS_KNOWLEDGE_SIGNING_KEY="$(rand_hex_32)"

"$ROOT/scripts/init-e2e.sh"

echo
echo '==> Building/reusing the Helios custom WSO2 AI Gateway 1.2 image and starting the connected Gateway'
DEMO_HOME="$ROOT" GATEWAY_HOME="$GW" \
  "$ROOT/modular-ai-guardrails/scripts/build-and-restart.sh"

compose_args=(-f docker-compose.yaml)
[[ -f "$GW/docker-compose.helios.override.yaml" ]] && compose_args+=(-f docker-compose.helios.override.yaml)
HTTPS_MAPPING="$(cd "$GW" && docker compose "${compose_args[@]}" port gateway-runtime 8443 | tail -1)"
HTTPS_PORT="${HTTPS_MAPPING##*:}"
[[ "$HTTPS_PORT" =~ ^[0-9]+$ ]] || { echo "ERROR: could not detect Gateway host HTTPS port from: $HTTPS_MAPPING" >&2; exit 1; }
export WSO2_AI_GATEWAY_URL="https://localhost:${HTTPS_PORT}"

echo "Gateway ingress detected at $WSO2_AI_GATEWAY_URL"

echo
echo '==> Destructive Helios application reset: revoke keys, delete all LLM proxies, keep/reconfigure enterprise-openai, recreate both proxies and fresh keys'
OPENAI_API_KEY="$OPENAI_API_KEY" \
OPENAI_MODEL="${OPENAI_MODEL:-gpt-4o-mini}" \
WSO2_AI_GATEWAY_URL="$WSO2_AI_GATEWAY_URL" \
  node "$ROOT/scripts/bootstrap-gateway.mjs"

set -a
# shellcheck disable=SC1090
source "$ROOT/.helios.env"
set +a

# Fail early if the generated BFF signing key and the key injected into the
# runtime container ever diverge. Only hashes are compared/printed.
RUNTIME_CONTEXT_KEY="$(cd "$GW" && docker compose "${compose_args[@]}" exec -T gateway-runtime sh -c 'printf %s "$HELIOS_CONTEXT_SIGNING_KEY"' 2>/dev/null || true)"
if [[ -z "$RUNTIME_CONTEXT_KEY" ]]; then
  echo 'ERROR: HELIOS_CONTEXT_SIGNING_KEY is not present in gateway-runtime.' >&2
  exit 1
fi
HOST_FP="$(printf %s "$HELIOS_CONTEXT_SIGNING_KEY" | shasum -a 256 | awk '{print substr($1,1,12)}')"
RUNTIME_FP="$(printf %s "$RUNTIME_CONTEXT_KEY" | shasum -a 256 | awk '{print substr($1,1,12)}')"
unset RUNTIME_CONTEXT_KEY
if [[ "$HOST_FP" != "$RUNTIME_FP" ]]; then
  echo "ERROR: Helios context-signing key mismatch (BFF=$HOST_FP runtime=$RUNTIME_FP)." >&2
  exit 1
fi
echo "Helios context-signing key synchronized with gateway-runtime ($HOST_FP)."

echo
echo '==> Live Gateway acceptance tests'
node "$ROOT/scripts/gateway-acceptance.mjs"

echo
echo '==> Starting Helios UI/BFF in gateway mode'
"$ROOT/scripts/start-e2e.sh"

echo
echo 'E2E HELIOS IS READY'
echo 'UI:                  http://localhost:5173'
echo 'BFF health:          http://localhost:5173/api/health'
echo "Gateway ingress:     $WSO2_AI_GATEWAY_URL"
echo 'Gateway controller:  http://localhost:9090'
echo 'Controller health:   http://localhost:9094/api/admin/v1/health'
echo 'Env mode:            gateway'
echo
if command -v open >/dev/null 2>&1; then open 'http://localhost:5173' >/dev/null 2>&1 || true; fi
