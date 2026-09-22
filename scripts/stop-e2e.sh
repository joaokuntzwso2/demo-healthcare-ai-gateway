#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$ROOT/scripts/stop-local.sh" || true
GW="$ROOT/wso2apip-healthcare-ai-gateway-1.1.0"
KEYENV="$GW/configs/keys.env"
if [[ -f "$KEYENV" ]]; then
  (cd "$GW" && docker compose -p helios-ai-gateway --env-file "$KEYENV" down --remove-orphans) || true
else
  (cd "$GW" && docker compose -p helios-ai-gateway down --remove-orphans) || true
fi
echo 'Helios E2E stopped. Controller volume is preserved.'
