# TRUSTPAY mobile app

The app is a Flutter client for the TRUSTPAY API. Local development uses the
Flutter SDK and the checked-in `pubspec.lock` file. The ordinary local checks
are:

```sh
cd APP
flutter pub get
flutter analyze --no-fatal-infos
flutter test
```

The signed release workflow is [`.github/workflows/mobile-release.yml`](../.github/workflows/mobile-release.yml).
It is dispatch-only and runs in the protected `mobile-staging` or
`mobile-production` GitHub environment selected by the dispatch input. It
analyzes and tests the exact checkout, then builds Android and iOS artifacts
with Flutter **3.44.6**, obfuscation and split debug symbols, including Android
R8 mapping and the iOS dSYM archive.
Artifacts are uploaded for review only; this workflow does not publish to a
store or deploy a service.

## Release configuration

Before either native build, the pipeline creates the transient
`APP/config/release.json`, validates it, and removes it in a cleanup trap. Do
not commit a release configuration or put backend/provider credentials in one.
The validator prints field-level failures only and never prints configuration
values.

Run the same local preflight against a protected, untracked configuration file
with:

```sh
./scripts/check-mobile-release-config.sh \
  --environment production \
  --config /path/to/release.json
```

The JSON object must contain only these string fields:

| Field | Requirement |
| --- | --- |
| `API_BASE_URL` | HTTPS. Production must be exactly `https://api.trustpayhq.com`. |
| `WEBSITE_BASE_URL` | HTTPS. Production must be exactly `https://trustpay.xyz`. |
| `SUPABASE_URL` | HTTPS project URL on an allowlisted `*.supabase.co` host. |
| `SUPABASE_PUBLISHABLE_KEY` | Nonempty public Supabase key. Service-role and secret markers are rejected. |
| `SENTRY_DSN` | Nonempty HTTPS DSN on `sentry.io` or a Sentry subdomain. |
| `SENTRY_ENVIRONMENT` | `production` for a production target, `staging` for a staging target. |
| `API_CERTIFICATE_SHA256_PINS` | At least two distinct lowercase 64-character SHA-256 hex pins, separated by commas. |

The `SENTRY_ENVIRONMENT` check keeps the target explicit in release metadata;
it does not by itself change SDK behavior. Runtime environment selection and
transport enforcement still require the corresponding app and platform wiring.

The validator rejects local/private hosts, production builds pointed at staging
or sandbox hosts, PEM/private-key material, and provider or backend credential
fields such as `MONNIFY_*`, `VTPASS_*`, `*_SECRET`, `*_TOKEN`,
`*_PASSWORD`, `*_PRIVATE_KEY`, and `*_API_KEY`. Provider credentials remain
backend-only in the server secret manager.

The native secure transport factory enforces these pins on both API and refresh
Dio clients in release builds, in addition to normal CA/hostname validation.
Pins are SHA-256 of the leaf certificate DER, not SPKI hashes. Supabase SDK
traffic and browser-opened links use separate TLS transports and are not covered
by this adapter. Android/iOS local device-risk signals block sensitive API
mutations when risky or unavailable; they are not server attestation. Physical
device and certificate-rotation acceptance is still required. Public production promotion is
blocked unless the protected platform-security gate is marked `verified`, links
to independently reviewed HTTPS evidence, and records the exact candidate
commit in `MOBILE_PLATFORM_SECURITY_EVIDENCE_COMMIT`. Missing current and
backup pins, a missing adapter, or missing integrity evidence therefore keeps
G06 a release blocker.

## Protected workflow inputs

Create separate `mobile-staging` and `mobile-production` GitHub environments
with required reviewers and release-branch policies before using the workflow.
Keep their backend, Supabase and Sentry values separate. Their non-secret
variables are:

```text
MOBILE_API_BASE_URL
MOBILE_WEBSITE_BASE_URL
MOBILE_SUPABASE_URL
MOBILE_SENTRY_ENVIRONMENT
MOBILE_API_CERTIFICATE_SHA256_PINS
MOBILE_PLATFORM_SECURITY_GATE
MOBILE_PLATFORM_SECURITY_EVIDENCE_URL
MOBILE_PLATFORM_SECURITY_EVIDENCE_COMMIT
IOS_TEAM_ID
IOS_BUNDLE_IDENTIFIER
IOS_PROVISIONING_PROFILE_NAME
```

Their protected secrets are:

```text
MOBILE_SUPABASE_PUBLISHABLE_KEY
MOBILE_SENTRY_DSN
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_PASSWORD
ANDROID_KEY_ALIAS
IOS_CERTIFICATE_BASE64
IOS_CERTIFICATE_PASSWORD
IOS_PROVISIONING_PROFILE_BASE64
IOS_EXPORT_OPTIONS_PLIST_BASE64
```

The Android job fails before compiling when its upload keystore or passwords
are absent or invalid. The iOS job fails before compiling when its distribution
certificate, provisioning profile, export options or team metadata are absent,
invalid or mismatched. Signing files and the transient config are removed after
each job. No provider key, service-role key or backend secret is accepted as a
mobile build input.

The production dispatch is also restricted to the protected `main` branch or
a version tag. A staging dispatch may use `main` or `dev`. The production path
does not upload an artifact to Google Play or App Store Connect; store review,
publication and pilot activation remain separate owner-approved actions.

## iOS simulator Keychain access

Keep local ad-hoc signing enabled when installing a Debug build on the iOS
simulator. A build made with `CODE_SIGNING_ALLOWED=NO` can compile and launch,
but iOS 26.5 rejects secure-storage access with error `-34018` when the app
has no `application-identifier` entitlement. The app then remains locked.
For direct Xcode simulator builds, use `CODE_SIGNING_ALLOWED=YES` and
`CODE_SIGN_IDENTITY=-`; Xcode supplies the simulator identity entitlement.
This local signing does not require an Apple distribution certificate and
does not validate App Store signing. Install over the existing bundle to
preserve simulator app data.

## External prerequisites

Local analyzer and unit/widget tests do not establish release readiness. Before
calling a signed artifact production-ready, the release owner still needs:

- Android upload signing and Apple distribution access installed in the
  protected environment.
- A real first-party API certificate pin set with a current and independently
  managed backup pin, plus a tested rotation runbook. The app must consume the
  pins through a maintained transport adapter for both API and refresh traffic.
- A real Android/iOS device-integrity implementation and device evidence; a
  Dart define or a passing shell preflight cannot stand in for that evidence.
- Separate staging backend/Supabase resources, a Sentry project, symbol upload
  and a sanitized crash that symbolicates in the intended environment.
- Native artifact installation and startup checks on a physical Android device
  and iPhone, followed by the required financial, KYC, support, operational,
  security and release approvals in `DOCS/MOBILE-LAUNCH-CHECKLIST.md`.

No signing credentials, provider secrets, live account identifiers or pins are
stored in this repository or in this README.

The exact external provisioning and server-verification requirements for Play
Integrity and App Attest are recorded in
[`docs/MOBILE-ATTESTATION-PROVISIONING.md`](docs/MOBILE-ATTESTATION-PROVISIONING.md).
