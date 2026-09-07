# macOS local signing

Aura intentionally uses a stable self-signed code-signing identity instead of an Apple Developer ID certificate.

This is for local/private distribution where the priority is keeping the same macOS code identity across Aura upgrades so TCC file-access permissions do not reset on every build.

## Stable identity

- Bundle ID: `com.xrsec.aura`
- Signing authority: `Aura Local Code Signing`
- Certificate SHA-1: `CAF294D421B7F39B39572CA12C8ABA8F7289E926`
- Certificate validity: 2026-09-07 through 2046-09-02

The expected Designated Requirement is anchored to both the Bundle ID and the fixed self-signed certificate root. The certificate fingerprint is pinned by the CI scripts so accidentally replacing the certificate causes the release build to fail instead of silently changing Aura's macOS identity.

## Repository material

`scripts/macos/aura-code-signing.p12.enc` contains the code-signing PKCS#12 bundle encrypted again with AES-256-CBC + PBKDF2 (250000 iterations). The decryption password is not stored in the repository.

GitHub Actions requires the repository secret:

- `AURA_MACOS_CERT_PASSWORD`

The same password protects the inner PKCS#12 bundle and the outer encrypted repository file.

## Release flow

On macOS runners:

1. `scripts/macos/import-signing-identity.sh` decrypts the encrypted bundle into the runner temp directory.
2. It imports the identity into a temporary keychain and puts that keychain in the user search list.
3. It checks that the imported certificate fingerprint matches the pinned Aura certificate.
4. It intentionally does **not** call `security add-trusted-cert`; that command can block on headless GitHub-hosted macOS runners, and trust-store mutation is not required for `codesign` to use the imported identity.
5. It exports `APPLE_SIGNING_IDENTITY=Aura Local Code Signing` for Tauri.
6. Tauri signs the executable and the full `.app` bundle.
7. `scripts/macos/verify-signature.sh` verifies the bundle ID, signing authority, certificate fingerprint, resource seal, and Designated Requirement.

The workflow intentionally does not notarize the application. This signing identity is not an Apple Developer ID certificate and is not intended to satisfy public Gatekeeper distribution requirements.

## Permission migration

Existing Aura builds released before this signing identity used ad-hoc or missing signatures. Moving from those builds to the first stable self-signed build can require one final macOS Files & Folders authorization. Subsequent releases signed with the same pinned identity should retain the same code identity instead of changing with every binary hash.
