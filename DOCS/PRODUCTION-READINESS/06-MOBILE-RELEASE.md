# 06 — Mobile Release and Device Security

## Goal

Release Android and iOS apps that protect sessions, transaction PINs, network traffic, and signing keys.

## Owner

Mobile lead, release manager, and security reviewer.

## Steps

- [ ] Run `flutter pub get`, `flutter analyze`, and `flutter test` on a clean CI runner.
- [ ] Configure production Android upload signing and iOS distribution signing in the secret manager; never commit keystores, certificates, or provisioning profiles.
- [ ] Build release artifacts with debug signing, debug logging, cleartext traffic, and test endpoints disabled.
- [ ] Wire certificate pinning using approved live certificate/SPKI pins and document rotation and emergency disable procedures.
- [ ] Wire a vetted Android/iOS device-integrity signal; require step-up or block high-risk actions according to the risk policy.
- [ ] Verify secure storage, biometric unlock, PIN lockout, logout clearing, refresh-token rotation, screenshot policy, clipboard policy, and app background behavior.
- [ ] Test on supported OS versions and real devices, including offline mode, poor networks, revoked certificates, rooted/jailbroken devices, and app upgrades.
- [ ] Submit internal/beta builds, review crash reports, and obtain mobile security and product sign-off.

## Evidence required

CI logs, signed APK/AAB/IPA hashes, signing-key custody record, pin-rotation runbook, device test matrix, crash-free metrics, and store review results.

## Exit criteria

Release artifacts are reproducible and signed, production traffic is protected, high-risk device signals work, and the mobile owner approves the exact build hashes.
