#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1 || ! command -v go >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    command -v node >/dev/null 2>&1 || brew install node
    command -v go >/dev/null 2>&1 || brew install go
  else
    echo 'Node.js 20+ and Go 1.23+ are required. Install them, then re-run this script.' >&2
    exit 1
  fi
fi
"$ROOT/scripts/doctor.sh"

if [[ ! -f "$ROOT/.helios.env" ]]; then
  rand(){ openssl rand -hex 32; }
  cat > "$ROOT/.helios.env" <<ENV
export LLM_MODE=deterministic
export PORT=5173
export HELIOS_CONTEXT_SIGNING_KEY='$(rand)'
export HELIOS_PSEUDONYM_KEY='$(rand)'
export HELIOS_APPROVAL_KEY='$(rand)'
export HELIOS_KNOWLEDGE_SIGNING_KEY='$(rand)'
ENV
  chmod 600 "$ROOT/.helios.env"
fi
source "$ROOT/.helios.env"

echo '==> Validating and compiling all custom Go policies'
bash "$ROOT/modular-ai-guardrails/scripts/test-modular-policies.sh"

echo '==> Running Node security/service tests'
cd "$ROOT/healthcare-ai-security-console"
npm test

echo '==> Building production frontend'
npm run build

echo '==> Starting deterministic Helios demo'
"$ROOT/scripts/start-local.sh"

echo
echo 'FIRST RUN COMPLETE'
echo "UI:      http://localhost:${PORT:-5173}"
echo "Health:  http://localhost:${PORT:-5173}/api/health"
echo "Scenarios: http://localhost:${PORT:-5173}/api/scenarios"
echo 'Mode: deterministic (no external LLM or WSO2 credentials required)'
