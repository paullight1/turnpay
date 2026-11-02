# Mobile attestation provisioning requirements

This app currently exposes a `trustpay/device_integrity` method channel with
local Android and iOS heuristics. A `clear` result means that the native code
did not find a known local marker; it does not prove that the app is genuine,
the device is uncompromised, or that a request came from this build. The Dart
client therefore fails closed for sensitive mutations when the local signal is
`risky` or `unavailable`, while the server must continue to treat the signal as
untrusted until remote attestation is implemented.

The current repository cannot provide server-verified attestation. `pubspec.yaml`
has no Play Integrity or DeviceCheck/App Attest client dependency, the native
channel does not produce signed platform tokens, and the backend has no
challenge, token-verification, device-key, or assertion endpoint. Adding a
client boolean or returning `clear` from the channel would not close this gap.

## Android: Play Integrity

Use the official Play Integrity Android library through a small native bridge
and keep all verdict decisions on the server. The [official setup guide](https://developer.android.com/google/play/integrity/setup)
requires a Google Cloud project and recommends linking it to the app in Play
Console.

The release owner must provision all of the following separately for staging
and production:

1. Register the exact package `app.trustpay.com` in the corresponding Play
   Console application. Record the Play app identifier, package name, and the
   Google Play app-signing SHA-256 certificate fingerprint. The upload key and
   Play app-signing key are different; the server policy must be based on the
   certificate that Play uses for the installed artifact.
2. Create or select a Google Cloud project, enable the Play Integrity API, and
   link that project under Play Console → **Protected with Play** → **Play
   Integrity API**. Grant the backend's least-privilege Google service account
   access needed to call Google's token-decryption endpoint. Keep the service
   account key in the server secret manager; never ship it in the app.
3. Decide whether the implementation uses Standard or Classic requests. For a
   money action, use a one-time server challenge/request hash that binds the
   token to the authenticated user, HTTP method and path, canonical amount and
   currency, beneficiary/provider fields, and the idempotency key. Do not use a
   timestamp or a client-generated random value without server issuance.
4. Add the native Android library and a Flutter method-channel/plugin bridge.
   The bridge should return the opaque token to Dart only long enough to send it
   with the matching server challenge; it must never decode or interpret the
   token locally. Cache only non-secret request metadata and expire unused
   challenges.
5. Have the server decrypt and verify every token before allowing the bound
   sensitive action. It must check the package name, request nonce/request hash,
   token timestamp and replay status, application integrity (`PLAY_RECOGNIZED`),
   licensing (`LICENSED` where Play distribution is required), and the selected
   device-integrity tier. Treat empty or `UNEVALUATED` verdicts as a failed
   step-up/block according to the risk policy. Play's [verdict reference](https://developer.android.com/google/play/integrity/setup#default-verdicts)
   lists the application and device values that must be evaluated.
6. Test an internal or closed Play track with the production package/signing
   identity, a modified/sideloaded APK, an emulator, a rooted/test-key device,
   expired challenges, duplicate tokens, changed request bodies, and response
   loss. Record verdicts and enforcement decisions without logging tokens.

Google-managed response encryption is preferred. If self-managed encryption
keys are selected, key custody, rotation, and a tested fallback must be owned by
operations; no encryption key belongs in this repository or the APK.

## iOS: App Attest

Use `DCAppAttestService` through a native bridge. Apple requires an App ID and
server-side verification; the [App Attest guide](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity)
describes the key, attestation, and assertion flow.

The Apple release owner must provision all of the following separately for
development/staging and production:

1. Register the exact Bundle ID used by `APP/ios/Runner` in the Apple
   Developer account and confirm the Team ID, bundle identifier, and
   distribution certificate/profile all match the artifact. Enable the App
   Attest capability for that App ID.
2. Add the entitlement
   `com.apple.developer.devicecheck.appattest-environment` to the signed
   target. Use `development` for sandbox testing and `production` for the
   production/TestFlight path; Apple documents the values and distribution
   behavior [here](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.developer.devicecheck.appattest-environment).
   The provisioning profile must include the capability and the entitlement.
3. On a supported physical device, generate one App Attest key per TrustPay
   user/device binding and persist only the key identifier in Keychain. The
   private key remains in Apple's Secure Enclave. Simulator, unsupported-device,
   reinstall, migration, and restore cases must start a new enrollment or use
   the documented risk-policy fallback.
4. Obtain a one-time challenge from the TrustPay server, hash it as Apple
   specifies, and send the key identifier plus the attestation object to the
   server. The server must verify the Apple certificate chain/attestation object,
   app identifier (Team ID plus Bundle ID), challenge, key identifier, and
   environment before marking the key usable. Store the verified key record and
   counter server-side; do not trust a client-side “attested” flag.
5. For each protected money action, obtain a fresh server challenge and create
   an App Attest assertion over a canonical representation of the challenge,
   authenticated user, method/path, amount/currency, beneficiary/provider data,
   and idempotency key. The server must verify the assertion, key identifier,
   counter monotonicity, challenge freshness, and exact request binding before
   settlement authorization.
6. Test a real signed iPhone build for first enrollment, repeat assertions,
   replayed assertions, counter rollback, changed amount/beneficiary, key loss,
   app reinstall, unsupported devices, expired challenges, and offline/retry
   behavior. Do not mark unsupported devices as attested; route them through an
   explicit server risk decision.

## Shared server contract before enabling money approval

The backend must own a short-lived challenge endpoint and an atomic consume or
replay record. A challenge should include a server-generated identifier, expiry,
authenticated user/device binding, intended operation, and canonical request
hash. The protected mutation must receive the attestation artifact and
challenge reference in the same idempotent attempt. Verification must happen
before any wallet or provider side effect, and audit logs should record the
provider, key/device reference, verdict class, challenge ID, and decision while
redacting token and assertion bytes.

Biometric app unlock remains available in the app, but it does not authorize a
money action. Until this contract exists and is verified on both platforms,
every money action requires a freshly entered transaction PIN.

## Evidence required to remove the blocker

- Native dependency versions and the exact Android/iOS bridge implementation.
- Staging and production Play Console/Cloud project IDs, package/signing
  fingerprints, App ID/Team ID, and signed entitlement evidence held by the
  release owner.
- Backend verifier tests for valid, expired, replayed, altered, unsupported,
  and mismatched-user artifacts, plus an atomic challenge-consumption test.
- Real-device evidence from a signed Play internal/closed-track build and a
  signed iPhone/TestFlight build, including the negative cases above.
- Monitoring and rotation procedures for Play Cloud credentials, Apple
  provisioning, app keys, and challenge/verdict failure rates.

Until those external prerequisites and server changes are delivered, the local
heuristics in this app are the only available device signal and must not be
described as Play Integrity or App Attest.
