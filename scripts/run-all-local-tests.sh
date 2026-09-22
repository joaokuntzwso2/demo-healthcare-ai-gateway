#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$ROOT/scripts/doctor.sh"
bash "$ROOT/modular-ai-guardrails/scripts/test-modular-policies.sh"
(cd "$ROOT/healthcare-ai-security-console" && npm test && npm run build)
echo 'ALL HELIOS LOCAL TESTS AND BUILDS PASSED'
