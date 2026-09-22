#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
check(){ if command -v "$1" >/dev/null 2>&1; then printf 'OK   %-12s %s\n' "$1" "$($1 --version 2>/dev/null | head -1 || true)"; else printf 'MISS %-12s %s\n' "$1" "$2"; fail=1; fi; }
check node 'Install Node.js 20+ (brew install node)'
check go 'Install Go 1.23+ (brew install go)'
check curl 'curl is required'
if command -v docker >/dev/null 2>&1; then printf 'OK   %-12s %s\n' docker "$(docker --version 2>/dev/null | head -1 || true)"; else printf 'INFO %-12s %s\n' docker 'Only required for real WSO2 Gateway mode'; fi
if command -v ap >/dev/null 2>&1; then printf 'OK   %-12s %s\n' ap "$(ap version 2>/dev/null | head -1 || true)"; else printf 'INFO %-12s %s\n' ap 'Only required to build the custom WSO2 Gateway image'; fi
node_major=$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)
if (( node_major < 20 )); then echo 'ERROR Node.js 20+ is required.'; fail=1; fi
if command -v go >/dev/null 2>&1; then
  go_minor=$(go version | sed -E 's/.*go1\.([0-9]+).*/\1/' || echo 0)
  if [[ "$go_minor" =~ ^[0-9]+$ ]] && (( go_minor < 23 )); then echo 'ERROR Go 1.23+ is required for the local policy workspace.'; fail=1; fi
fi
printf '\nRepository: %s\n' "$ROOT"
printf 'Scenario count: '
node -e "import('$ROOT/healthcare-ai-security-console/server/scenarios.mjs').then(m=>console.log(m.scenarios.length))"
exit "$fail"
