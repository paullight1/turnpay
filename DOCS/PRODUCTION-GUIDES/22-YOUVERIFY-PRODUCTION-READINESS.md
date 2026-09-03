# Youverify Production Readiness

> Historical record. Superseded on 2026-09-03 by `23-NINJA-KYC-PRODUCTION-READINESS.md`. Youverify remains only as an explicit backend rollback adapter.

Last reviewed: 2026-09-02

## Current decision

**NO-GO for production KYC activation.** The application-side Youverify integration is implemented and locally verified, but two external gates remain open:

1. The configured sandbox token receives HTTP `403` with `Permission denied` from the Youverify identity endpoint. The Youverify account owner must grant the required identity-verification product permissions or replace the token with one that has them.
2. `YOUVERIFY_WEBHOOK_URL` is not configured. A public staging HTTPS callback must be deployed, entered in the Youverify dashboard, and exercised with a correctly signed callback.

Do not switch to `https://api.youverify.co`, load production identity data, or enable KYC-dependent live features until every launch gate below is signed off.

## Implemented controls

- Web and Flutter call the authenticated TRUSTPAY backend; the Youverify token and webhook secret never go to a client.
- Direct verification requires a validated country/type/identifier payload, explicit consent, `JwtAuthGuard`, rate limiting, and an idempotency key.
- Consent time, version, and source are stored with the provider attempt.
- An active-attempt database constraint and transactional reservation prevent concurrent submissions for the same user and document type.
- Identity values are encrypted at rest and masked in API responses. Admin receives a small evidence allowlist, not the provider payload.
- A provider result is verified only when the record is found and all requested validation passes.
- Callback signatures are checked against the exact raw request body with timing-safe HMAC comparison.
- Accepted callbacks are stored in a durable, deduplicated inbox before HTTP acknowledgement. Processing uses claims, bounded retries, stale-claim recovery, and terminal dead-letter state.
- KYC state, tier changes, and audit records are committed in Prisma transactions.
- Staging and production boot validation requires strong Youverify, webhook, and PII settings. `/health/ready` reports only `kyc: configured` or `kyc: misconfigured`, never secret values.
- Authenticated web dashboard and admin routes do not load the Tawk support script.

These controls provide technical evidence; they do not certify legal compliance. Compliance counsel and the accountable business owner must approve consent language, retention, supported identity types, tier rules, and production use.

## Required environment

Store values only in the backend deployment secret manager.

```env
KYC_PROVIDER=youverify
YOUVERIFY_API_KEY=<server-side token, at least 16 characters>
YOUVERIFY_BASE_URL=https://api.sandbox.youverify.co
YOUVERIFY_WEBHOOK_URL=https://<staging-api-host>/api/webhooks/kyc/youverify
YOUVERIFY_WEBHOOK_SECRET=<dashboard signing key, at least 16 characters>
YOUVERIFY_WEBHOOK_ID=<optional operational identifier>
PII_ENCRYPTION_KEY=<at least 32 characters from the secret manager>
PII_KEY_VERSION=1
```

Production must use `YOUVERIFY_BASE_URL=https://api.youverify.co`. Never place any of these values in `NEXT_PUBLIC_*`, Flutter build constants, source control, logs, screenshots, or tickets.

## Sandbox certification

Record the date, environment, deployment SHA, tester, provider reference, and outcome for each case. Store only masked identifiers in evidence.

- [ ] Resolve the current `403 Permission denied` response with Youverify and confirm the token has the required Nigerian and Ghanaian identity-product permissions.
- [ ] Deploy the exact release candidate to staging and confirm `/health/live` is `ok` and `/health/ready` is `ready` with `kyc: configured`.
- [ ] Register the public staging callback ending in `/api/webhooks/kyc/youverify` in the Youverify dashboard.
- [ ] Confirm a valid provider signature is accepted and an invalid or missing signature is rejected.
- [ ] Nigeria: certify BVN success, NIN success, name mismatch/review, not-found, provider error, and Tier 1 to Tier 2 progression.
- [ ] Ghana: certify passport success, voter-card success, mismatch/review, not-found, provider error, and Tier 1 to Tier 2 progression.
- [ ] Retry a direct request with the same idempotency key and confirm it does not create a second active provider attempt.
- [ ] Race two different idempotency keys for the same user/type and confirm one request receives a safe conflict.
- [ ] Replay an identical signed callback and confirm one inbox event, one state transition, and one audit effect.
- [ ] Deliver an out-of-order callback and confirm a terminal verified/rejected result is not downgraded.
- [ ] Force a processor failure, confirm retry/backoff and stale-claim recovery, then confirm dead-letter alerting after five failures.
- [ ] Confirm logs, traces, Sentry, analytics, admin responses, and support tools contain no raw identity number, signature, token, or provider payload.
- [ ] Confirm web and mobile require unchecked-by-default consent and remain actionable at Tier 1 for the complementary identity.

## Operations

Alert on:

- Youverify request error rate, latency, circuit-breaker state, and permission failures.
- Inbox rows in `FAILED` state with no `nextAttemptAt` (dead-lettered).
- Old `RECEIVED` or `PROCESSING` rows beyond the expected worker interval.
- A sustained increase in `REVIEW_REQUIRED`, signature failures, duplicate conflicts, or provider/account mismatches.

For an incident, disable the affected KYC-dependent feature, preserve the sanitized inbox and audit trail, rotate a compromised token or signing secret, and replay only after the root cause is understood. Never edit a user to a higher tier directly; use the audited review or provider-result path.

## Production launch gates

- [ ] Sandbox checklist is complete with retained evidence.
- [ ] Youverify has approved the production account and required products.
- [ ] Live token and a separately generated live webhook secret are in the production secret manager.
- [ ] Production callback is registered and a signed test event succeeds end to end.
- [ ] Database migration `034_youverify_production_readiness` is deployed and rollback/restore procedures are rehearsed.
- [ ] Dead-letter monitoring and an on-call owner are active.
- [ ] Privacy/compliance owners approve consent text, retention/deletion, Ghana and Nigeria identity use, and tier limits.
- [ ] A controlled live happy path and mismatch path succeed with masked evidence and no PII leakage.
- [ ] A named owner records the final GO decision.

## Provider references

- API key setup and permissions: https://doc.youverify.co/getting-started/getting-your-api-key
- Sandbox and production environments: https://doc.youverify.co/getting-started/environment
- Webhook signing: https://doc.youverify.co/webhooks
- Nigeria NIN verification: https://doc.youverify.co/know-your-customer-services-kyc/id-data-matching-eidv/nigeria/verify-national-identification-number-nin
