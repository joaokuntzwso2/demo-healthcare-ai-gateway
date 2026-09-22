#!/usr/bin/env bash

set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is not installed."
  exit 1
fi

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "ERROR: gitleaks is not installed."
  echo "Install it with:"
  echo "  brew install gitleaks"
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: run this from inside the Git repository."
  exit 1
fi

STAGED_COUNT="$(
  git diff --cached --name-only --diff-filter=ACMR | wc -l | tr -d ' '
)"

if [ "$STAGED_COUNT" = "0" ]; then
  echo "No staged files to scan."
  exit 0
fi

echo "Checking $STAGED_COUNT staged files..."

# ------------------------------------------------------------
# First gate: forbidden filename types
# ------------------------------------------------------------

BAD_PATHS="$(mktemp)"
trap 'rm -f "$BAD_PATHS"' EXIT

git diff \
  --cached \
  --name-only \
  --diff-filter=ACMR \
  -z |
while IFS= read -r -d '' path; do

  # Explicitly permit sanitized environment examples.
  case "$path" in
    .env.example|*/.env.example|*.env.example|*/*.env.example)
      continue
      ;;
  esac

  case "$path" in
    .env|*/.env|\
    .env.*|*/.env.*|\
    *.env|*.env.*|\
    *.key|*.pem|*.p12|*.pfx|*.jks|*.keystore|\
    *.bin|\
    *.zip|*.tar|*.tar.gz|*.tgz|\
    *.log|\
    */config.toml|*/config.toml.*|\
    .npmrc|*/.npmrc|\
    .pypirc|*/.pypirc|\
    .netrc|*/.netrc|\
    credentials.json|*/credentials.json|\
    *service-account*.json|\
    */aesgcm-keys/*)
      printf '%s\n' "$path" >> "$BAD_PATHS"
      ;;
  esac
done

if [ -s "$BAD_PATHS" ]; then
  echo
  echo "ERROR: potentially sensitive/runtime files are staged:"
  echo
  cat "$BAD_PATHS"
  echo
  echo "Remove them from staging before committing:"
  echo "  git restore --staged <file>"
  exit 1
fi

# ------------------------------------------------------------
# Second gate: unexpectedly large files
# ------------------------------------------------------------

LARGE_PATHS="$(mktemp)"
trap 'rm -f "$BAD_PATHS" "$LARGE_PATHS"' EXIT

MAX_BYTES=$((20 * 1024 * 1024))

git diff \
  --cached \
  --name-only \
  --diff-filter=ACMR \
  -z |
while IFS= read -r -d '' path; do

  size="$(git cat-file -s ":$path" 2>/dev/null || echo 0)"

  if [ "$size" -gt "$MAX_BYTES" ]; then
    printf '%s (%s bytes)\n' "$path" "$size" >> "$LARGE_PATHS"
  fi
done

if [ -s "$LARGE_PATHS" ]; then
  echo
  echo "ERROR: staged files larger than 20 MiB detected:"
  echo
  cat "$LARGE_PATHS"
  echo
  echo "Review these before committing."
  exit 1
fi

# ------------------------------------------------------------
# Third gate:
# Build a temporary filesystem containing EXACTLY the staged
# versions of the files and run Gitleaks against it.
# ------------------------------------------------------------

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/helios-gitleaks.XXXXXX")"

cleanup() {
  rm -rf "$TMP_DIR"
  rm -f "$BAD_PATHS" "$LARGE_PATHS"
}

trap cleanup EXIT

git diff \
  --cached \
  --name-only \
  --diff-filter=ACMR \
  -z |
while IFS= read -r -d '' path; do

  target="$TMP_DIR/$path"
  mkdir -p "$(dirname "$target")"

  git show ":$path" > "$target"
done

echo
echo "Running Gitleaks against staged content..."

if ! gitleaks dir "$TMP_DIR" \
  --redact \
  --no-banner; then

  echo
  echo "ERROR: Gitleaks detected a possible secret."
  echo "Nothing should be committed until this is reviewed."
  exit 1
fi

echo
echo "Security scan passed."
