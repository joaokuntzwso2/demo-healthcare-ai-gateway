#!/usr/bin/env bash
set -euo pipefail
PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_HOME="${DEMO_HOME:-$(cd "$PACKAGE_ROOT/.." && pwd)}"
GATEWAY_HOME="${GATEWAY_HOME:-$DEMO_HOME/wso2apip-ai-gateway-1.2.0}"
CONTROLLER_ADMIN_URL="${CONTROLLER_ADMIN_URL:-http://localhost:9094/api/admin/v1/health}"
RUNTIME_ADMIN_URL="${RUNTIME_ADMIN_URL:-http://localhost:9901/ready}"
READY_ATTEMPTS="${READY_ATTEMPTS:-90}"
READY_INTERVAL_SECONDS="${READY_INTERVAL_SECONDS:-2}"
FORCE_BUILD="${HELIOS_FORCE_GATEWAY_BUILD:-false}"
EXPECTED_GATEWAY_VERSION="1.2.0"
IMAGE_PREFIX="ghcr.io/wso2/api-platform/healthcare-ai-security-gateway"
EXPECTED_CONTROLLER_IMAGE="${IMAGE_PREFIX}-gateway-controller:${EXPECTED_GATEWAY_VERSION}"
EXPECTED_RUNTIME_IMAGE="${IMAGE_PREFIX}-gateway-runtime:${EXPECTED_GATEWAY_VERSION}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEMO_HOME/evidence"

command -v ap >/dev/null || { echo 'ERROR: ap CLI is required.' >&2; exit 1; }
command -v docker >/dev/null || { echo 'ERROR: Docker is required.' >&2; exit 1; }
[[ -f "$GATEWAY_HOME/api-platform.env" ]] || { echo "ERROR: $GATEWAY_HOME/api-platform.env missing. Run WSO2 1.2 setup first." >&2; exit 1; }
[[ -f "$GATEWAY_HOME/build.yaml" ]] || { echo "ERROR: $GATEWAY_HOME/build.yaml missing." >&2; exit 1; }
: "${HELIOS_CONTEXT_SIGNING_KEY:?HELIOS_CONTEXT_SIGNING_KEY must be generated before starting the Gateway}"

for required_policy in api-key-auth host-rewrite request-rewrite respond set-headers subscription-validation; do
  grep -q "name: ${required_policy}$" "$GATEWAY_HOME/build.yaml" || {
    echo "ERROR: build.yaml is missing required WSO2 policy: ${required_policy}" >&2
    exit 1
  }
done

for required_custom in \
  custom-model-allowlist-guardrail custom-resource-budget-guardrail canonicalize-and-classify \
  custom-jailbreak-authority-bypass-guardrail custom-request-regex-guardrail custom-request-phi-dlp-guardrail \
  custom-tenant-workforce-context-guard custom-patient-encounter-binding-guard custom-purpose-scope-guard \
  custom-clinical-note-injection-guard custom-sensitive-clinical-context-guard custom-trusted-clinical-source-guard \
  custom-tool-delegation-guard custom-clinical-action-authority-guard custom-clinician-approval-guard \
  custom-prompt-decorator custom-request-block-finalizer custom-response-phi-leakage-guard \
  custom-unsafe-output-guard custom-response-url-guard custom-clinical-reliance-guard custom-structured-clinical-output-guard; do
  grep -q "name: ${required_custom}$" "$GATEWAY_HOME/build.yaml" || {
    echo "ERROR: build.yaml is missing Helios policy: ${required_custom}" >&2
    exit 1
  }
done

"$PACKAGE_ROOT/scripts/test-modular-policies.sh"
cd "$GATEWAY_HOME"

controller_image=""
runtime_image=""

if docker image inspect "$EXPECTED_CONTROLLER_IMAGE" >/dev/null 2>&1; then
  controller_image="$EXPECTED_CONTROLLER_IMAGE"
fi
if docker image inspect "$EXPECTED_RUNTIME_IMAGE" >/dev/null 2>&1; then
  runtime_image="$EXPECTED_RUNTIME_IMAGE"
fi

if [[ "$FORCE_BUILD" == true || -z "$controller_image" || -z "$runtime_image" ]]; then
  BUILD_LOG="$DEMO_HOME/evidence/gateway-build-$STAMP.log"
  echo "==> Building custom WSO2 AI Gateway ${EXPECTED_GATEWAY_VERSION} images (WSO2 built-ins + 22 Helios policies)"
  echo "    Old 1.1.x Helios images, if present, are ignored."

  ap_version_output="$(ap version 2>/dev/null || ap --version 2>/dev/null || true)"
  echo "AP CLI: ${ap_version_output:-unknown}"

  set -o pipefail
  ap gateway image build --name healthcare-ai-security-gateway 2>&1 | tee "$BUILD_LOG"

  # Never trust a stale image with the right repository but the wrong tag.
  # build.yaml declares gateway.version=1.2.0, so these exact images must exist.
  if ! docker image inspect "$EXPECTED_CONTROLLER_IMAGE" >/dev/null 2>&1; then
    echo "ERROR: build did not produce expected controller image: $EXPECTED_CONTROLLER_IMAGE" >&2
    echo "Check AP CLI version (WSO2 recommends 0.9.1+ for current 1.2 policy builds)." >&2
    exit 1
  fi
  if ! docker image inspect "$EXPECTED_RUNTIME_IMAGE" >/dev/null 2>&1; then
    echo "ERROR: build did not produce expected runtime image: $EXPECTED_RUNTIME_IMAGE" >&2
    echo "Check AP CLI version (WSO2 recommends 0.9.1+ for current 1.2 policy builds)." >&2
    exit 1
  fi

  controller_image="$EXPECTED_CONTROLLER_IMAGE"
  runtime_image="$EXPECTED_RUNTIME_IMAGE"
fi

[[ "$controller_image" == *":${EXPECTED_GATEWAY_VERSION}" && "$runtime_image" == *":${EXPECTED_GATEWAY_VERSION}" ]] || {
  echo "ERROR: refusing to start non-${EXPECTED_GATEWAY_VERSION} custom Gateway images." >&2
  echo "Controller: $controller_image" >&2
  echo "Runtime:    $runtime_image" >&2
  exit 1
}

cat > docker-compose.helios.override.yaml <<'YAML'
services:
  gateway-controller:
    image: ${HELIOS_CONTROLLER_IMAGE}
  gateway-runtime:
    image: ${HELIOS_RUNTIME_IMAGE}
    environment:
      HELIOS_CONTEXT_SIGNING_KEY: ${HELIOS_CONTEXT_SIGNING_KEY:?HELIOS_CONTEXT_SIGNING_KEY is required}
YAML

export HELIOS_CONTROLLER_IMAGE="$controller_image"
export HELIOS_RUNTIME_IMAGE="$runtime_image"

echo '==> Starting WSO2 AI Gateway 1.2 with Helios custom images'
docker compose -f docker-compose.yaml -f docker-compose.helios.override.yaml up -d --force-recreate --remove-orphans --pull never

printf 'Waiting for Gateway Controller and Runtime'
controller_ready=false
runtime_ready=false
for ((attempt=1; attempt<=READY_ATTEMPTS; attempt++)); do
  if [[ "$controller_ready" != true ]] && curl -fsS --max-time 3 "$CONTROLLER_ADMIN_URL" >/dev/null 2>&1; then controller_ready=true; fi
  if [[ "$runtime_ready" != true ]] && curl -fsS --max-time 3 "$RUNTIME_ADMIN_URL" >/dev/null 2>&1; then runtime_ready=true; fi
  if [[ "$controller_ready" == true && "$runtime_ready" == true ]]; then printf ' ready\n'; break; fi
  printf '.'
  sleep "$READY_INTERVAL_SECONDS"
done

if [[ "$controller_ready" != true || "$runtime_ready" != true ]]; then
  printf '\nERROR: Gateway readiness failed (controller=%s runtime=%s).\n' "$controller_ready" "$runtime_ready" >&2
  docker compose -f docker-compose.yaml -f docker-compose.helios.override.yaml ps -a >&2 || true
  docker compose -f docker-compose.yaml -f docker-compose.helios.override.yaml logs --tail=160 --no-color gateway-controller gateway-runtime >&2 || true
  exit 1
fi

echo "Custom controller image: $controller_image"
echo "Custom runtime image:    $runtime_image"
echo "HTTPS mapping:           $(docker compose -f docker-compose.yaml -f docker-compose.helios.override.yaml port gateway-runtime 8443 | tail -1)"
docker compose -f docker-compose.yaml -f docker-compose.helios.override.yaml ps
