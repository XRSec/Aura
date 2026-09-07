#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only supports macOS." >&2
  exit 1
fi

: "${AURA_MACOS_CERT_PASSWORD:?AURA_MACOS_CERT_PASSWORD is required}"

IDENTITY="${AURA_SIGNING_IDENTITY:-Aura Local Code Signing}"
EXPECTED_CERT_SHA1="${AURA_SIGNING_CERT_SHA1:-caf294d421b7f39b39572ca12c8aba8f7289e926}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENCRYPTED_P12_PATH="$SCRIPT_DIR/aura-code-signing.p12.enc"
WORK_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/aura-signing"
KEYCHAIN_PATH="$WORK_DIR/aura-signing.keychain-db"
P12_PATH="$WORK_DIR/aura-code-signing.p12"
CERT_PATH="$WORK_DIR/aura-code-signing.pem"
KEYCHAIN_PASSWORD="$(openssl rand -hex 24)"

[[ -f "$ENCRYPTED_P12_PATH" ]] || {
  echo "Encrypted Aura signing bundle is missing: $ENCRYPTED_P12_PATH" >&2
  exit 1
}

mkdir -p "$WORK_DIR"
chmod 700 "$WORK_DIR"
rm -f "$KEYCHAIN_PATH" "$P12_PATH" "$CERT_PATH"

openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 \
  -in "$ENCRYPTED_P12_PATH" \
  -out "$P12_PATH" \
  -pass pass:"$AURA_MACOS_CERT_PASSWORD"
chmod 600 "$P12_PATH"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$P12_PATH" -k "$KEYCHAIN_PATH" -P "$AURA_MACOS_CERT_PASSWORD" -T /usr/bin/codesign >/dev/null
security find-certificate -p -c "$IDENTITY" "$KEYCHAIN_PATH" > "$CERT_PATH"
security add-trusted-cert -r trustRoot -k "$KEYCHAIN_PATH" "$CERT_PATH"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" >/dev/null

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

if ! security find-identity -v -p codesigning "$KEYCHAIN_PATH" | grep -Fq "\"$IDENTITY\""; then
  echo "Signing identity '$IDENTITY' was imported but is not usable for code signing." >&2
  exit 1
fi

if [[ -n "${GITHUB_ENV:-}" ]]; then
  {
    echo "APPLE_SIGNING_IDENTITY=$IDENTITY"
    echo "AURA_SIGNING_KEYCHAIN=$KEYCHAIN_PATH"
  } >> "$GITHUB_ENV"
fi

echo "Imported stable macOS signing identity: $IDENTITY"
