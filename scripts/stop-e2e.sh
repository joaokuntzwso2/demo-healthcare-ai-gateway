#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT/.helios-console.pid" ]]; then
  pid="$(cat "$ROOT/.helios-console.pid" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  rm -f "$ROOT/.helios-console.pid"
fi
GW="$ROOT/wso2apip-ai-gateway-1.2.0"
if [[ -d "$GW" ]]; then
  args=(-f docker-compose.yaml)
  [[ -f "$GW/docker-compose.helios.override.yaml" ]] && args+=(-f docker-compose.helios.override.yaml)
  (cd "$GW" && docker compose "${args[@]}" down --remove-orphans) || true
fi
echo 'Helios E2E stopped. Gateway volumes, registration, api-platform.env, and .openai.env are preserved.'
