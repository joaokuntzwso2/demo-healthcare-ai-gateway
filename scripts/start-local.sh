#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONSOLE="$ROOT/healthcare-ai-security-console"
ENVFILE="$ROOT/.helios.env"
PIDFILE="$ROOT/.helios-console.pid"
LOGFILE="$ROOT/helios-console.log"
[[ -f "$ENVFILE" ]] && source "$ENVFILE"
export LLM_MODE=deterministic
export NODE_ENV=production
export PORT="${PORT:-5173}"
if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Helios is already running (PID $(cat "$PIDFILE")) at http://localhost:$PORT"
  exit 0
fi
cd "$CONSOLE"
if [[ ! -f "$CONSOLE/dist/index.html" ]]; then npm run build; fi
nohup node server/index.mjs >"$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"
for _ in {1..30}; do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "Helios Clinical AI Security is running: http://localhost:$PORT"
    echo "Log: $LOGFILE"
    if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT" >/dev/null 2>&1 || true; fi
    exit 0
  fi
  sleep 0.25
done
echo "Helios failed to become healthy. Last log lines:" >&2
tail -80 "$LOGFILE" >&2 || true
exit 1
