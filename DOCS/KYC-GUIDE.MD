# TRUSTPAY Ninja KYC Guide

Last reviewed: 2026-09-03

Ninja is TRUSTPAY's primary KYC provider for Nigerian BVN and NIN checks. Web
and Flutter call TRUSTPAY's authenticated backend. Ninja credentials must never
be placed in a browser, mobile build, `NEXT_PUBLIC_*` variable, log, screenshot,
ticket, or source-controlled environment file.

## Direct verification flow

1. The authenticated client sends `country: NG`, `type: BVN|NIN`, an 11-digit
   identifier, ISO date of birth, explicit consent, and an `Idempotency-Key` to
   `POST /api/kyc/verify`.
2. The backend validates the DTO, reserves a single active attempt, reads the
   user's legal first and last names, and uses the KYC document row ID as the
   stable Ninja reference.
3. The backend creates a short-lived Ninja session with `POST /auth/session`.
   The token is cached until shortly before its five-minute expiry. Concurrent
   requests share one authentication call.
4. The backend calls `POST /api/identity/identify` in `verify` mode. One `401`
   causes one session refresh and one replay with the same reference.
5. A result is accepted only when `found=true`, `verified=true`, and
   `recommendation=accept`. Ambiguous results require review; not-found and
   rejected results fail closed.
6. The identifier is encrypted at rest. Only an allowlisted, sanitized evidence
   summary is stored or returned, and the public identifier remains masked.
7. Document status, verification status, user status, tier, and audit data are
   committed transactionally.

Ninja direct identity verification is synchronous and does not use a webhook.
The existing Youverify callback path remains isolated for rollback and historical
attempts only.

## Supported checks

| Country | TRUSTPAY type | Ninja `idType` | Required input |
| --- | --- | --- | --- |
| Nigeria | `BVN` | `bvn` | 11-digit BVN, legal names, date of birth |
| Nigeria | `NIN` | `nin` | 11-digit NIN, legal names, date of birth |

The clients do not offer Ghana, passport, driver's licence, or voter's card in
this release. Unsupported combinations are rejected before a provider call.

## Backend environment

Sandbox:

```env
KYC_PROVIDER=ninja
NINJA_CLIENT_KEY=<exact sandbox dashboard value>
NINJA_CLIENT_SECRET=<exact sandbox dashboard value>
NINJA_BASE_URL=https://api.sandbox.ninja.boucloud.io
PII_ENCRYPTION_KEY=<at least 32 characters from the secret manager>
PII_KEY_VERSION=1
```

Production changes only the credentials and URL:

```env
KYC_PROVIDER=ninja
NINJA_CLIENT_KEY=<exact live dashboard value>
NINJA_CLIENT_SECRET=<exact live dashboard value>
NINJA_BASE_URL=https://api.ninja.boucloud.io
```

Do not create a `NINJA_TOKEN` variable. TRUSTPAY requests and refreshes session
tokens internally. Variable names are literal—there is no `ninjaapi+` prefix.

Official references:

- Developer documentation: https://www.ninja.ng/docs/
- Published pricing: https://www.ninja.ng/pricing/

## Sandbox test identities

Use provider test data only in sandbox. As documented by Ninja at the review
date:

| Identifier | Expected result | Match data |
| --- | --- | --- |
| `77777777777` | Found | James Bond, `1975-01-01` |
| `55555555555` | Not found | No match |
| `00000000000` | Simulated upstream error | No verification |

Never use these identifiers against the live host.

## Status and tier mapping

| Ninja result | TRUSTPAY verification | User effect |
| --- | --- | --- |
| Found, verified, accept | `VERIFIED` | First BVN/NIN reaches at least Tier 1; both reach Tier 2 |
| Found but ambiguous/review | `REVIEW_REQUIRED` | `SUBMITTED`; no automatic tier promotion |
| Not found or reject | `REJECTED` | `REJECTED` unless the user already has a stronger terminal state |
| Invalid response or transport failure | `FAILED` | No promotion; safe retry is allowed |

HTTP success alone never means identity success.

## Security and privacy controls

- `JwtAuthGuard`, rate limiting, DTO validation, explicit consent, and
  `Idempotency-Key` are mandatory on the canonical mutation.
- The client-supplied name is not trusted. Legal names come from the authenticated
  TRUSTPAY profile.
- Identifier and DOB must not appear in application logs, audit metadata, error
  messages, Sentry, analytics, or provider evidence.
- Raw provider responses, images, phone numbers, addresses, and supplied values
  must not be stored or returned.
- Only the two exact Ninja HTTPS hosts are allowed; arbitrary configured hosts
  fail closed.
- All status/tier/audit changes remain in one Prisma transaction.
- Consent version and time are recorded with the attempt.

## Sandbox certification

- [ ] Put only the sandbox client key and secret in the backend secret manager.
- [ ] Deploy migration `035_ninja_kyc_provider` and regenerate Prisma Client.
- [ ] Confirm `/api/health/live` is `ok` and `/api/health/ready` reports KYC
      `configured` without returning config values.
- [ ] Verify NIN success with `77777777777`, James Bond, and `1975-01-01`.
- [ ] Verify the `55555555555` not-found state is clear and retryable.
- [ ] Verify the `00000000000` provider-error state is clear and retryable.
- [ ] Retry an identical client request and confirm the idempotency response is
      replayed without a second active attempt.
- [ ] Race two requests for the same user/type and confirm only one reservation
      reaches Ninja.
- [ ] Confirm token reuse and one-time `401` reauthentication in logs/metrics
      without exposing credentials or tokens.
- [ ] Search logs, traces, Sentry, admin responses, and analytics for raw BVN,
      NIN, DOB, names, tokens, and provider payloads; all must be absent.
- [ ] Confirm the web and mobile screens cover empty, loading, network error,
      review, rejected, provider failure, Tier 1 next step, and Tier 2 complete.

## Production gates

- [ ] Ninja has approved TRUSTPAY's live account and issued live credentials.
- [ ] Compliance/privacy owners approve consent language, lawful basis,
      retention/deletion, tier rules, and Nigerian BVN/NIN use.
- [ ] Live credentials exist only in the production backend secret manager.
- [ ] `NINJA_BASE_URL=https://api.ninja.boucloud.io`; no sandbox host or test
      identity is present in production.
- [ ] `./scripts/validate-production-config.sh true` succeeds in the target
      environment.
- [ ] A controlled live happy path and mismatch path succeed with masked
      evidence and no PII leakage.
- [ ] Provider error rate, latency, circuit-breaker state, review-rate changes,
      and repeated authentication failures have alerts and a named owner.
- [ ] A named accountable owner records the final GO decision.

Passing automated tests is necessary but is not regulatory certification.
Transfers, withdrawals, VTU, and virtual-account provisioning must stay behind
the approved KYC/tier gates until production certification is complete.
