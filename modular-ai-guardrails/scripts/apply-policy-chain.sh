#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node "$ROOT/modular-ai-guardrails/scripts/validate-policy-chain.mjs"
: "${OPENAI_API_KEY:?OPENAI_API_KEY is required because this command also ensures the local provider credential is current}"
exec node "$ROOT/scripts/bootstrap-gateway.mjs"
