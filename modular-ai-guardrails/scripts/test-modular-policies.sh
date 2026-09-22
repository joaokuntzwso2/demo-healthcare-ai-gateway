#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/local-test/go.work"
mods=$(cd "$ROOT/local-test" && GOWORK="$WORK" go list -m -f '{{.Path}}' | grep '^github.com/helios-clinical-ai/')
(cd "$ROOT/local-test" && GOWORK="$WORK" go test $mods)
node "$ROOT/scripts/validate-policy-chain.mjs"
echo "ALL LOCAL MODULAR POLICY CHECKS PASSED"
