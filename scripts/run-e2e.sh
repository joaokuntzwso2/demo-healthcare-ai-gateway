#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${OPENAI_API_KEY:?Set OPENAI_API_KEY, or run ./run.sh which prompts securely for it.}"

"$ROOT/scripts/init-e2e.sh"
# shellcheck disable=SC1090
source "$ROOT/.helios.env"
export HELIOS_CONTEXT_SIGNING_KEY

echo
echo '==> Building and launching the real custom WSO2 AI Gateway'
DEMO_HOME="$ROOT" GATEWAY_HOME="$ROOT/wso2apip-healthcare-ai-gateway-1.1.0" \
  "$ROOT/modular-ai-guardrails/scripts/build-and-restart.sh"

echo
echo '==> Creating/updating enterprise-openai and both App LLM Proxies, applying exact policy chains, generating separate keys'
OPENAI_API_KEY="$OPENAI_API_KEY" node "$ROOT/scripts/bootstrap-gateway.mjs"

# Reload because bootstrap wrote the generated proxy keys.
# shellcheck disable=SC1090
source "$ROOT/.helios.env"
export LLM_MODE WSO2_AI_GATEWAY_URL WSO2_PROVIDER_ACCESS_KEY WSO2_CLINICAL_PROXY_API_KEY WSO2_PATIENT_PROXY_API_KEY WSO2_TLS_INSECURE WSO2_API_KEY_HEADER WSO2_DEFAULT_MODEL HELIOS_CONTEXT_SIGNING_KEY HELIOS_PSEUDONYM_KEY HELIOS_APPROVAL_KEY HELIOS_KNOWLEDGE_SIGNING_KEY

echo
echo '==> Live Gateway + agent acceptance tests'
node "$ROOT/scripts/gateway-acceptance.mjs"

echo
echo '==> Starting Helios UI/BFF in REAL GATEWAY mode'
"$ROOT/scripts/start-e2e.sh"

echo
echo 'E2E HELIOS IS READY'
echo 'UI:                  http://localhost:5173'
echo 'BFF health:          http://localhost:5173/api/health'
echo 'Gateway ingress:     https://localhost:8443'
echo 'Gateway controller:  http://localhost:9090'
echo 'Controller health:   http://localhost:9094/health'
echo 'Env mode:            gateway'
echo
if command -v open >/dev/null 2>&1; then open 'http://localhost:5173' >/dev/null 2>&1 || true; fi
