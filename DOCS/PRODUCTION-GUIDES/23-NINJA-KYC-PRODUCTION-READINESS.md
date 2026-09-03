# Ninja KYC Production Readiness

Last reviewed: 2026-09-03

## Current decision

**GO for sandbox integration; NO-GO for live KYC activation.** The application
integration, privacy controls, provider result normalization, web UI, and Flutter
UI are implemented and covered by focused automated tests. Live activation still
requires external Ninja credentials, live-account approval, compliance/privacy
sign-off, and retained staging evidence.

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

## User action required now

Create or open the Ninja dashboard and copy the sandbox client key and client
secret into the **backend deployment secret manager** using exactly:

```env
KYC_PROVIDER=ninja
NINJA_CLIENT_KEY=<sandbox value>
NINJA_CLIENT_SECRET=<sandbox value>
NINJA_BASE_URL=https://api.sandbox.ninja.boucloud.io
```

Do not paste credentials into chat, source files, Vercel public variables, or
Flutter build arguments. No webhook setup and no generated `NINJA_TOKEN` are
needed for this direct flow.

## Release sequence

1. Add sandbox credentials to the backend secret manager.
2. Apply Prisma migrations and deploy the backend.
3. Confirm the readiness endpoint reports `kyc: configured`.
4. Deploy the web release and build the mobile release candidate.
5. Execute and record every sandbox case in `DOCS/KYC-GUIDE.MD`.
6. Obtain compliance/privacy and provider approval.
7. Replace only the backend credentials and base URL with live values.
8. Run one controlled live verification, inspect masked evidence, and record the
   final GO/NO-GO decision before increasing exposure.

## Rollback

If Ninja cannot be used, set `KYC_PROVIDER=youverify` only after restoring all
required Youverify server and webhook settings and re-running production config
validation. Client apps continue calling `/api/kyc/verify`; they do not choose a
provider. Do not expose the legacy `/api/kyc/youverify/verify` route in UI.

The detailed security, sandbox, operations, and production checklists live in
`DOCS/KYC-GUIDE.MD`.
