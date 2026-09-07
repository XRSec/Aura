#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only supports macOS." >&2
  exit 1
fi

APP_PATH="${1:-}"
if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "Usage: $0 /path/to/Aura.app" >&2
  exit 1
fi

EXPECTED_BUNDLE_ID="${AURA_BUNDLE_ID:-com.xrsec.aura}"
EXPECTED_IDENTITY="${AURA_SIGNING_IDENTITY:-Aura Local Code Signing}"
EXPECTED_CERT_SHA1="${AURA_SIGNING_CERT_SHA1:-caf294d421b7f39b39572ca12c8aba8f7289e926}"

codesign --verify --deep --strict --verbose=2 "$APP_PATH"

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Contents/Info.plist")"
SIGNATURE_DETAILS="$(codesign -dv --verbose=4 "$APP_PATH" 2>&1)"
SIGNATURE_ID="$(printf '%s\n' "$SIGNATURE_DETAILS" | awk -F= '/^Identifier=/{print $2; exit}')"
AUTHORITY="$(printf '%s\n' "$SIGNATURE_DETAILS" | awk -F= '/^Authority=/{print $2; exit}')"
DESIGNATED_REQUIREMENT="$(codesign -d -r- "$APP_PATH" 2>&1 | tail -n1)"
CERT_SHA1="$(security find-certificate -c "$EXPECTED_IDENTITY" -Z | awk '/SHA-1 hash:/{print tolower($3); exit}')"
EXPECTED_CERT_SHA1="$(printf '%s' "$EXPECTED_CERT_SHA1" | tr '[:upper:]' '[:lower:]')"

[[ "$BUNDLE_ID" == "$EXPECTED_BUNDLE_ID" ]] || {
  echo "Unexpected CFBundleIdentifier: $BUNDLE_ID" >&2
  exit 1
}

[[ "$SIGNATURE_ID" == "$EXPECTED_BUNDLE_ID" ]] || {
  echo "Unexpected code-signing Identifier: $SIGNATURE_ID" >&2
  exit 1
}

[[ "$AUTHORITY" == "$EXPECTED_IDENTITY" ]] || {
  echo "Unexpected signing Authority: $AUTHORITY" >&2
  exit 1
}

[[ -n "$CERT_SHA1" ]] || {
  echo "Unable to resolve SHA-1 fingerprint for '$EXPECTED_IDENTITY'." >&2
  exit 1
}

[[ "$CERT_SHA1" == "$EXPECTED_CERT_SHA1" ]] || {
  echo "Unexpected signing certificate fingerprint: $CERT_SHA1" >&2
  exit 1
}

printf '%s\n' "$DESIGNATED_REQUIREMENT" | grep -Fq "identifier \"$EXPECTED_BUNDLE_ID\"" || {
  echo "Designated Requirement does not contain the expected bundle identifier." >&2
  exit 1
}

printf '%s\n' "$DESIGNATED_REQUIREMENT" | grep -Fqi "certificate root = H\"$CERT_SHA1\"" || {
  echo "Designated Requirement is not anchored to the stable Aura signing certificate." >&2
  exit 1
}

printf '%s\n' "$SIGNATURE_DETAILS" | grep -Fq 'Info.plist entries=' || {
  echo "Info.plist is not bound into the application signature." >&2
  exit 1
}

printf '%s\n' "$SIGNATURE_DETAILS" | grep -Fq 'Sealed Resources version=' || {
  echo "Application resources are not sealed by the signature." >&2
  exit 1
}

echo "macOS signature verification passed"
echo "  Bundle ID: $BUNDLE_ID"
echo "  Authority: $AUTHORITY"
echo "  Requirement: $DESIGNATED_REQUIREMENT"
