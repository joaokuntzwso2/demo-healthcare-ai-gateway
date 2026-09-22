#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GW="$ROOT/wso2apip-healthcare-ai-gateway-1.1.0"
ENVFILE="$ROOT/.helios.env"
KEYENV="$GW/configs/keys.env"

for cmd in node python3 openssl docker ap curl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: missing required command: $cmd" >&2; exit 1; }
done
docker info >/dev/null 2>&1 || { echo "ERROR: Docker is installed but the daemon is not running." >&2; exit 1; }

mkdir -p "$GW/configs" "$GW/resources/listener-certs" "$GW/resources/certificates" "$ROOT/evidence"
[[ -f "$GW/configs/config.toml" ]] || cp "$GW/configs/config-template.toml" "$GW/configs/config.toml"

# Create or preserve local demo secrets. All generated values are shell-safe hex.
python3 - "$ENVFILE" <<'PY'
from pathlib import Path
import secrets, sys
p=Path(sys.argv[1])
existing={}
if p.exists():
    for line in p.read_text().splitlines():
        s=line.strip()
        if not s or s.startswith('#') or '=' not in s: continue
        k,v=s.split('=',1)
        v=v.strip()
        if len(v)>=2 and v[0]==v[-1] and v[0] in "\"'": v=v[1:-1]
        existing[k.strip()]=v
for k in ['HELIOS_CONTEXT_SIGNING_KEY','HELIOS_PSEUDONYM_KEY','HELIOS_APPROVAL_KEY','HELIOS_KNOWLEDGE_SIGNING_KEY']:
    if not existing.get(k) or 'replace' in existing[k] or 'change-me' in existing[k]:
        existing[k]=secrets.token_hex(32)
# These are overwritten after proxy-key generation, but keep prior working values if present.
existing.setdefault('LLM_MODE','gateway')
existing.setdefault('WSO2_AI_GATEWAY_URL','https://localhost:8443')
existing.setdefault('WSO2_TLS_INSECURE','true')
existing.setdefault('WSO2_API_KEY_HEADER','X-API-Key')
existing.setdefault('WSO2_DEFAULT_MODEL','gpt-4o-mini')
lines=['# Helios local runtime configuration. Generated/updated by scripts/init-e2e.sh and bootstrap-gateway.mjs.']
for k,v in existing.items():
    # single-quote shell-safe values
    q=str(v).replace("'", "'\\''")
    lines.append(f"{k}='{q}'")
p.write_text('\n'.join(lines)+'\n')
p.chmod(0o600)
PY

# shellcheck disable=SC1090
source "$ENVFILE"

CERT="$GW/resources/listener-certs/default-listener.crt"
PKEY="$GW/resources/listener-certs/default-listener.key"
pair_ok=false
if [[ -s "$CERT" && -s "$PKEY" ]]; then
  cert_hash="$(openssl x509 -in "$CERT" -pubkey -noout 2>/dev/null | openssl pkey -pubin -outform DER 2>/dev/null | shasum -a 256 | awk '{print $1}' || true)"
  key_hash="$(openssl pkey -in "$PKEY" -pubout -outform DER 2>/dev/null | shasum -a 256 | awk '{print $1}' || true)"
  [[ -n "$cert_hash" && "$cert_hash" == "$key_hash" ]] && pair_ok=true
fi
if [[ "$pair_ok" != true ]]; then
  echo "==> Generating local self-signed TLS certificate for localhost"
  openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 365 \
    -subj '/CN=localhost' \
    -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
    -keyout "$PKEY" -out "$CERT" >/dev/null 2>&1
  chmod 600 "$PKEY"
fi

cat > "$KEYENV" <<ENV
HELIOS_CONTEXT_SIGNING_KEY=$HELIOS_CONTEXT_SIGNING_KEY
GATEWAY_CONTROLPLANE_HOST=${GATEWAY_CONTROLPLANE_HOST:-}
GATEWAY_REGISTRATION_TOKEN=${GATEWAY_REGISTRATION_TOKEN:-}
ENV
chmod 600 "$KEYENV"

echo "Helios E2E local configuration initialized."
echo "Runtime environment: $ENVFILE"
echo "Gateway environment: $KEYENV"
