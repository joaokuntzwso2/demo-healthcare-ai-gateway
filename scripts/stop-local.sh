#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDFILE="$ROOT/.helios-console.pid"
if [[ ! -f "$PIDFILE" ]]; then echo 'Helios is not running (no PID file).'; exit 0; fi
PID="$(cat "$PIDFILE")"
if kill -0 "$PID" 2>/dev/null; then kill "$PID"; fi
rm -f "$PIDFILE"
echo 'Helios stopped.'
