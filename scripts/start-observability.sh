#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

curl -fsS http://127.0.0.1:5173/metrics >/dev/null || {
  echo "ERROR: Helios BFF metrics endpoint is not reachable. Run ./run.sh or ./scripts/start-e2e.sh first." >&2
  exit 1
}

docker compose -f observability/docker-compose.yaml up -d

for _ in {1..90}; do
  if curl -fsS http://127.0.0.1:19090/-/ready >/dev/null 2>&1 && \
     curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "Helios observability stack is ready."
    echo "Grafana:    http://localhost:3000/d/helios-executive/helios-clinical-ai-executive?orgId=1&refresh=5s"
    echo "Prometheus: http://localhost:19090"
    exit 0
  fi
  sleep 1
done

echo "ERROR: observability stack did not become ready." >&2
docker compose -f observability/docker-compose.yaml ps >&2 || true
exit 1
