# Phase 01 Environment, Webhook, And Secrets Matrix

> Archived environment matrix. `BACKEND/.env.example` and `DOCS/PROVIDER-SOURCE-OF-TRUTH.MD` are authoritative.

## Environment Separation

| Environment | Purpose | Provider Credentials | Webhook URL | Allowed Operations |
|---|---|---|---|---|
| Local | Developer testing with mocks and sandbox only | Test keys only or empty | Local tunnel only when needed | No live account provisioning, no live money movement. |
| Staging | Integrated sandbox provider testing | Sandbox keys only | Staging HTTPS endpoint | Sandbox DVA, sandbox deposits, sandbox transfer tests. |
| Production | Live users and live providers | Live keys only | Production HTTPS endpoint | Live operations after go/no-go approval. |

## Backend Environment Variables

Existing variables from `BACKEND/.env.example`:

| Variable | Purpose | Required For Phase 1 |
|---|---|---|
| `NODE_ENV`, `PORT` | Runtime mode and backend bind port | Required |
| `WEB_URL`, `ADMIN_URL` | Callback and allowed-origin domains when present | Required before deployed sandbox |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | JWT signing secrets when using local JWT auth | Required if not fully delegated to Supabase |
| `PAYSTACK_SECRET_KEY` | Paystack API authentication | Sandbox/provider readiness |
| `PAYSTACK_PUBLIC_KEY` | Client-side Paystack integrations where needed | Later frontend funding |
| `PAYSTACK_WEBHOOK_URL` | Dashboard webhook endpoint | Provider dashboard setup |
| `PAYSTACK_WEBHOOK_SECRET` | Paystack webhook validation strategy, if selected | Must resolve against current code before build |
| `PAYSTACK_DVA_PREFERRED_BANK` | Preferred DVA bank slug, e.g. `test-bank` in sandbox | Sandbox account assignment |
| `PAYSTACK_TRANSFER_SOURCE` | Provider transfer source, if required by chosen API flow | Confirm before withdrawal build |
| `FLUTTERWAVE_SECRET_KEY` | Flutterwave API authentication | Sandbox/provider readiness |
| `FLUTTERWAVE_PUBLIC_KEY` | Client-side Flutterwave integrations where needed | Later frontend funding |
| `FLUTTERWAVE_ENCRYPTION_KEY` | Flutterwave encrypted payload support where needed | Provider-specific flows |
| `FLUTTERWAVE_SECRET_HASH` | Flutterwave webhook verification hash | Standardized replacement for old `FLUTTERWAVE_HASH` placeholder |
| `FLUTTERWAVE_WEBHOOK_URL` | Dashboard webhook endpoint | Provider dashboard setup |
| `BANKING_ENABLED` | Master banking feature flag | Must default `false` |
| `VIRTUAL_ACCOUNTS_ENABLED` | Virtual-account feature flag | Must default `false` |
| `WITHDRAWALS_ENABLED` | Withdrawal feature flag | Must default `false` |
| `BANKING_PROVIDER_PRIMARY` | Primary provider routing | Prevent accidental provider drift |
| `BANKING_PROVIDER_FALLBACK` | Optional fallback provider | Must never silently duplicate money movement |
| `SUPPORTED_BANKING_CURRENCIES` | Launch currency control | Start with `NGN` until GHS is approved |
| `BANKING_SANDBOX_MODE` | Explicit sandbox safety switch | Production must not run with sandbox mode |
| `PII_ENCRYPTION_KEY`, `PII_KEY_VERSION` | Sensitive field encryption and rotation | Required before storing account/KYC identifiers |
| `BANK_ACCOUNT_ENCRYPTION_KEY` | Account-number encryption | Required before beneficiary storage |
| `RECONCILIATION_CRON` | Reconciliation schedule | Required before production banking |
| `WEBHOOK_QUEUE_NAME`, `DLQ_NAME` | Async processing and dead-letter queue names | Required before async webhook processing |
| `ADMIN_REVIEW_WEBHOOK_ALERT_CHANNEL` | Alert target for review-worthy failures | Required before live launch |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Idempotency, rate limits, cache | Required before money flows |
| `DATABASE_URL` | Prisma/Postgres | Required |

Open variables to confirm before banking implementation:

| Variable | Purpose | Notes |
|---|---|---|
| `PAYSTACK_WEBHOOK_SECRET` | Whether Paystack uses a separate webhook secret in TRUSTPAY config or continues secret-key HMAC verification. | Resolve before code changes. |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Current repo includes Supabase/JWT surfaces; confirm final auth source before banking launch. | Do not use weak defaults. |

## Webhook Dashboard Setup

Paystack:

- Configure webhook URL in dashboard API Keys & Webhooks.
- Staging: `https://staging-api.trustpay.../api/webhooks/paystack`
- Production: `https://api.trustpay.../api/webhooks/paystack`
- Events to handle before launch: `charge.success`, DVA assignment events, customer identification events, `transfer.success`, `transfer.failed`, `transfer.reversed`.

Flutterwave:

- Configure webhook URL and secret hash in dashboard.
- Staging: `https://staging-api.trustpay.../api/webhooks/flutterwave`
- Production: `https://api.trustpay.../api/webhooks/flutterwave`
- Events to handle before launch: `charge.completed` for deposits, transfer completion/failure events for payouts.
- Select one Flutterwave API generation/version before implementation and match its documented webhook signature header. Do not continue with mixed assumptions from old and new docs.

## Secret Handling Rules

- Never commit real keys.
- Never log keys, webhook signatures, account encryption keys, OTPs, full account numbers, BVN, NIN, or passwords.
- Keep sandbox and production keys in separate secret stores.
- Rotate keys before launch if any test key has been shared in chat, screenshots, or support tickets.
- Restrict production provider dashboards to approved operators only.

## Sandbox/Live Separation Checklist

- [ ] Separate Paystack sandbox and live merchant credentials.
- [ ] Separate Flutterwave sandbox and live merchant credentials.
- [ ] Separate PostgreSQL databases for dev/staging/prod.
- [ ] Separate Redis instances or namespaces for sandbox/prod idempotency keys, queues, and rate limits.
- [ ] Separate Supabase projects or isolated environments.
- [ ] Separate monitoring projects/environments.
- [ ] Production secrets stored only in a deployment secret store or secrets manager.
- [ ] No live provider credentials in local `.env`.
- [ ] `BANKING_ENABLED`, `VIRTUAL_ACCOUNTS_ENABLED`, and `WITHDRAWALS_ENABLED` default off until explicit go/no-go.
- [ ] Sandbox webhook URLs point only to sandbox backend.
- [ ] Live webhook URLs point only to production backend.
- [ ] Provider test events cannot hit production endpoints.
- [ ] Live account provisioning and live transfers require explicit operational approval.
- [ ] Runbooks clearly label sandbox commands versus live commands.

## Monitoring Readiness

Alerts required before live launch:

- Invalid webhook signature spike.
- Provider webhook processing failure.
- Provider event received but not processed.
- Deposit webhook with amount/currency mismatch.
- Withdrawal pending beyond SLA.
- Transfer failed or reversed.
- Reconciliation mismatch.
- Redis unavailable.
- Database transaction failures.
- Webhook queue backlog age above SLA.
- Dead-letter queue count greater than zero.
- Duplicate provider event/reference conflict rate above threshold.
- Provider API 5xx/timeout rate spike.
- Circuit breaker opened for Paystack or Flutterwave.
- Admin manual action performed on money movement.
- KYC verification rejection/manual-review spike.

Dashboards should include:

- Provider health by environment and provider.
- Webhook received, processed, failed, and retried counts.
- Pending transfer aging buckets.
- Deposit and withdrawal success/failure rates.
- Reconciliation report counts by mismatch type.
- Redis and PostgreSQL health.
- Audit log volume for admin banking actions.

## Version And Signature Decisions Required

| Provider | Decision Needed Before Build |
|---|---|
| Paystack | Confirm HMAC signing source and whether current secret-key based verification remains correct for the selected webhook setup. |
| Flutterwave | Confirm exact API generation, webhook header name, signature source, and dashboard secret-hash setup. Current repo code must not be extended until this is resolved. |

## Phase 1 Gaps Closed In Repo

- `BACKEND/.env.example` now includes non-secret placeholders for banking feature flags, provider webhook URLs, provider readiness variables, sensitive-data encryption keys, and queue names.

## Phase 1 Gaps Still Open

- `BACKEND/.env.example` placeholders are not runtime validation. Future implementation must add strict config validation.
- Existing webhook implementation must be revisited before banking because Flutterwave transfer completion must not share the deposit-credit path.
- Existing KYC storage includes raw `idNumber`; privacy controls in `07-DATA-PRIVACY-READINESS.MD` must be implemented before provider DVA work.
