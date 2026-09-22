#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATEWAY="$ROOT/wso2apip-ai-gateway-1.2.0"

echo
echo "============================================================"
echo " Starting WSO2 AI Gateway 1.2.0"
echo "============================================================"
echo

[[ -d "$GATEWAY" ]] || {
  echo "ERROR: Gateway directory not found:"
  echo "  $GATEWAY"
  exit 1
}

[[ -f "$GATEWAY/api-platform.env" ]] || {
  echo "ERROR: api-platform.env does not exist."
  echo
  echo "Run the one-time setup:"
  echo "  cd \"$GATEWAY\""
  echo "  ./scripts/setup.sh"
  exit 1
}

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not running."
  exit 1
fi

echo "Gateway directory:"
echo "  $GATEWAY"
echo

echo "Checking AI Workspace configuration..."

if grep -q '^APIP_GW_CONTROLLER_CONTROLPLANE_HOST=' \
  "$GATEWAY/api-platform.env"; then
  echo "OK: control-plane host configured"
else
  echo "WARNING: APIP_GW_CONTROLLER_CONTROLPLANE_HOST is not configured"
fi

if grep -q '^APIP_GW_CONTROLLER_CONTROLPLANE_TOKEN=' \
  "$GATEWAY/api-platform.env"; then
  echo "OK: control-plane token configured"
else
  echo "WARNING: APIP_GW_CONTROLLER_CONTROLPLANE_TOKEN is not configured"
fi

echo
echo "Starting Gateway..."

cd "$GATEWAY"

docker compose up -d

echo
echo "Waiting for Gateway Controller..."

for i in {1..60}; do
  if curl -fsS \
    http://localhost:9094/api/admin/v1/health \
    >/dev/null 2>&1; then
    echo "OK: Gateway Controller is healthy"
    break
  fi

  if [[ "$i" -eq 60 ]]; then
    echo "ERROR: Gateway Controller did not become healthy."
    echo
    docker compose ps
    echo
    docker compose logs --tail=100 gateway-controller
    exit 1
  fi

  sleep 1
done

echo "Waiting for Gateway Runtime..."

for i in {1..60}; do
  if curl -fsS \
    http://localhost:9901/ready \
    >/dev/null 2>&1; then
    echo "OK: Gateway Runtime is ready"
    break
  fi

  if [[ "$i" -eq 60 ]]; then
    echo "ERROR: Gateway Runtime did not become ready."
    echo
    docker compose logs --tail=100 gateway-runtime
    exit 1
  fi

  sleep 1
done

echo
echo "============================================================"
echo " WSO2 AI Gateway is running"
echo "============================================================"
echo
echo "Gateway HTTPS:       https://localhost:8443"
echo "Management API:      http://localhost:9090"
echo "Controller health:   http://localhost:9094/api/admin/v1/health"
echo "Envoy admin:         http://localhost:9901"
echo
echo "Containers:"
docker compose ps
