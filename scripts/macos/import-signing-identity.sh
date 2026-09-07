#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only supports macOS." >&2
  exit 1
fi

: "${AURA_MACOS_CERT_P12:?AURA_MACOS_CERT_P12 is required}"
: "${AURA_MACOS_CERT_PASSWORD:?AURA_MACOS_CERT_PASSWORD is required}"

# GitHub Secrets may preserve the newline copied from a password file.
# Aura's generated password is a single-line Base64 string, so normalize CR/LF.
CERT_PASSWORD="$(printf '%s' "$AURA_MACOS_CERT_PASSWORD" | tr -d '\r\n')"

IDENTITY="${AURA_SIGNING_IDENTITY:-Aura Local Code Signing}"
EXPECTED_CERT_SHA1="${AURA_SIGNING_CERT_SHA1:-caf294d421b7f39b39572ca12c8aba8f7289e926}"
WORK_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/aura-signing"
KEYCHAIN_PATH="$WORK_DIR/aura-signing.keychain-db"
P12_PATH="$WORK_DIR/aura-code-signing.p12"
KEYCHAIN_PASSWORD="$(openssl rand -hex 24)"

mkdir -p "$WORK_DIR"
chmod 700 "$WORK_DIR"
rm -f "$KEYCHAIN_PATH" "$P12_PATH"

printf '%s' "$AURA_MACOS_CERT_P12" | openssl base64 -d -A -out "$P12_PATH"
chmod 600 "$P12_PATH"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
if ! security import "$P12_PATH" -k "$KEYCHAIN_PATH" -P "$CERT_PASSWORD" -T /usr/bin/codesign >/dev/null; then
  echo "Failed to import Aura signing P12. Check that AURA_MACOS_CERT_P12 and AURA_MACOS_CERT_PASSWORD were generated as a matching pair." >&2
  exit 1
fi
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" >/dev/null

# Do not call `security add-trusted-cert` here. It can block indefinitely on
# GitHub-hosted macOS runners because they do not provide an interactive
# SecurityAgent session. codesign can still use the imported self-signed
# identity once this keychain is in the user search list.

IMPORTED_CERT_SHA1="$(security find-certificate -c "$IDENTITY" -Z "$KEYCHAIN_PATH" | awk '/SHA-1 hash:/{print tolower($3); exit}')"
EXPECTED_CERT_SHA1="$(printf '%s' "$EXPECTED_CERT_SHA1" | tr '[:upper:]' '[:lower:]')"
if [[ "$IMPORTED_CERT_SHA1" != "$EXPECTED_CERT_SHA1" ]]; then
  echo "Unexpected Aura signing certificate fingerprint: $IMPORTED_CERT_SHA1" >&2
  exit 1
fi

existing_keychains=()
while IFS= read -r keychain; do
  keychain="${keychain//\"/}"
  [[ -n "$keychain" ]] && existing_keychains+=("$keychain")
done < <(security list-keychains -d user)
security list-keychains -d user -s "$KEYCHAIN_PATH" "${existing_keychains[@]}"

# `security find-identity -p codesigning` reports self-signed identities as
# untrusted even though codesign can use them, so fingerprint pinning plus the
# actual post-build signature verification is the authoritative check.
security find-certificate -c "$IDENTITY" "$KEYCHAIN_PATH" >/dev/null

if [[ -n "${GITHUB_ENV:-}" ]]; then
  {
    echo "APPLE_SIGNING_IDENTITY=$IDENTITY"
    echo "AURA_SIGNING_KEYCHAIN=$KEYCHAIN_PATH"
  } >> "$GITHUB_ENV"
fi

echo "Imported stable macOS signing identity: $IDENTITY"
