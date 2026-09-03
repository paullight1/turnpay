# Ninja KYC Production Readiness

Last reviewed: 2026-09-03

## Current decision

**GO for sandbox integration; NO-GO for live KYC activation.** The application
integration, privacy controls, provider result normalization, web UI, and Flutter
UI are implemented and verified against Ninja's sandbox. Live activation still
requires Ninja live credentials, live-account approval, compliance/privacy
sign-off, and retained staging evidence.

## Verified sandbox state

On 2026-09-03, the configured sandbox credentials were exercised through the
real TRUSTPAY provider and the authenticated `/api/kyc/verify` endpoint:

- Ninja authentication and token reuse succeeded.
- The documented verified, not-found, and provider-error fixtures were handled.
- The authenticated success path stored one `NINJA` verification, recorded
  consent and result audit events, promoted the test account to Tier 1, and
  replayed safely with the same idempotency key.
- Database, Redis, and KYC readiness checks passed.
- Desktop and mobile browser coverage passed for empty, recovery, and completion
  states.

The synthetic account and related test records were removed after verification.

## What is already implemented

- Backend-only Ninja authentication with short-lived token caching and shared
  in-flight authentication.
- Direct Nigeria-only BVN/NIN verification through `POST /api/kyc/verify`.
- Validated ISO DOB, 11-digit identifiers, explicit consent, JWT protection,
  rate limiting, and required idempotency.
- One safe `401` reauthentication retry using the same provider reference.
- Fail-closed mapping: only found + verified + accept is automatically verified.
- Encrypted identifiers, masked responses, sanitized allowlisted evidence, and
  no stored DOB/provider raw payload.
- Transactional state/tier/audit updates and active-attempt race protection.
- Readiness/config validation for selected provider and environment.
- Web and Flutter empty/loading/error/review/rejected/failed/verified states.

## External action required for live activation

Obtain or activate the Ninja live client key and client secret, then add them to
the **production backend secret manager** using exactly:

```env
KYC_PROVIDER=ninja
NINJA_CLIENT_KEY=<live value>
NINJA_CLIENT_SECRET=<live value>
NINJA_BASE_URL=https://api.ninja.boucloud.io
```

Do not paste credentials into chat, source files, Vercel public variables, or
Flutter build arguments. No webhook setup and no generated `NINJA_TOKEN` are
needed for this direct flow.

## Release sequence

1. Retain the completed sandbox test evidence from `DOCS/KYC-GUIDE.MD`.
2. Obtain compliance/privacy approval and Ninja live-account approval.
3. Add the live Ninja credentials and base URL to the production backend secret
   manager.
4. Apply Prisma migrations and deploy the backend.
5. Confirm the readiness endpoint reports `kyc: configured`.
6. Deploy the web release and build the mobile release candidate.
7. Run one controlled live verification, inspect masked evidence, and record the
   final GO/NO-GO decision before increasing exposure.

## Rollback

If Ninja cannot be used, set `KYC_PROVIDER=youverify` only after restoring all
required Youverify server and webhook settings and re-running production config
validation. Client apps continue calling `/api/kyc/verify`; they do not choose a
provider. Do not expose the legacy `/api/kyc/youverify/verify` route in UI.

The detailed security, sandbox, operations, and production checklists live in
`DOCS/KYC-GUIDE.MD`.
