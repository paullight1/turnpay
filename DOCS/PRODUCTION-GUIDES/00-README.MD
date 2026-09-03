# TRUSTPAY Production Guides

These guides cover TRUSTPAY production functions that cannot be fully completed on a local machine without live credentials, live webhooks, provider dashboards, app-store accounts, or production infrastructure access.

Do not treat sandbox success as launch approval. Every money movement path must satisfy `DOCS/SECURITY-RULES.MD` before live enablement: idempotency, Prisma transactions for balances, DTO validation, auth guards, webhook signature checks, Decimal money handling, no negative balances, and audit logging.

## Guide Index

| Guide | Scope |
| --- | --- |
| `01-AUTH-SUPABASE.MD` | Supabase project, auth keys, JWT mode, OTP/SMS, web and mobile auth config |
| `02-DATABASE-REDIS.MD` | PostgreSQL, Prisma migrations, Redis, backups, TLS, operational checks |
| `03-PAYMENTS-FUNDING.MD` | Monnify reserved-account funding and webhook crediting |
| `04-VIRTUAL-ACCOUNTS.MD` | Monnify-only virtual-account activation |
| `05-WITHDRAWALS.MD` | Beneficiaries, bank resolution, payouts, reversals, and admin verification |
| `06-INTERNAL-TRANSFERS.MD` | TRUSTPAY user-to-user wallet transfers and ledger invariants |
| `07-EXCHANGE.MD` | NGN/GHS exchange, rate feeds, quotes, execution, and limits |
| `08-VTU.MD` | Airtime, data, cable, electricity, provider credentials, and reversals |
| `09-ADMIN-OPS.MD` | Admin launch controls, review queues, permissions, audit and support operations |
| `10-RECONCILIATION.MD` | Daily provider, ledger, wallet, webhook, and settlement reconciliation |
| `11-MOBILE-WEB-DEPLOYMENT.MD` | Backend, web, admin, Flutter, stores, monitoring, rollback |
| `12-TEST-LINT-MOCK-TYPING.MD` | Test/lint status and remaining typed-mock cleanup |
| `13-MONNIFY-ONLY-VIRTUAL-ACCOUNTS-STATUS.MD` | Current Monnify-only NGN virtual-account decision and activation checklist |
| `14-MANUAL-EXCHANGE-RECEIPT-FLOW.MD` | Manual and Monnify-verified exchange deposit review flow |
| `19-INTERNAL-TRANSFER-OPERATIONS.md` | Internal-transfer alerts, incident freeze, reconciliation, reversal, and recovery runbook |
| `20-INTERNAL-TRANSFER-CERTIFICATION.md` | Internal-transfer staging evidence, external approvals, and canary certification register |
| `21-SUPABASE-RENDER-VERCEL-LAUNCH.MD` | Authoritative V1 hosting topology, dashboard setup order, secrets, and verification gates |
| `22-YOUVERIFY-PRODUCTION-READINESS.md` | Historical Youverify readiness record; superseded for the active path |
| `23-NINJA-KYC-PRODUCTION-READINESS.md` | Active Ninja sandbox certification, privacy checks, evidence, and launch gates |

For V1 infrastructure, guide 21 is authoritative if an older guide mentions
DigitalOcean, Fly.io, Render Postgres, or a self-hosted production Postgres.

## Production Env Groups

Keep live values in the deployment secret manager, not in committed files. Use different values for local, staging, and production.

| Group | Variables |
| --- | --- |
| Runtime | `NODE_ENV`, `PORT`, `LOG_LEVEL`, `SENTRY_DSN` |
| Database | `DATABASE_URL` |
| Supabase | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` |
| Website | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WEBSITE_URL`, `NEXT_PUBLIC_ADMIN_URL` |
| Mobile build | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, API base URL build config |
| Redis | `REDIS_URL`, `REDIS_ALLOW_MEMORY_FALLBACK`, `TRUST_PROXY_HOPS` |
| OTP/SMS | `OTP_EXPIRES_IN`, `OTP_LENGTH`, `OTP_DEV_CODE`, `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| Monnify | `MONNIFY_BASE_URL`, `MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY`, `MONNIFY_CONTRACT_CODE`, `MONNIFY_WEBHOOK_URL`, `MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER`, `MONNIFY_GET_ALL_AVAILABLE_BANKS`, `MONNIFY_RESTRICT_PAYMENT_SOURCE` |
| Banking flags | `BANKING_ENABLED`, `VIRTUAL_ACCOUNTS_ENABLED`, `WITHDRAWALS_ENABLED`, `BANKING_PROVIDER_PRIMARY`, `SUPPORTED_BANKING_CURRENCIES`, `BANKING_SANDBOX_MODE` |
| Privacy | `PII_ENCRYPTION_KEY`, `PII_KEY_VERSION`, `BANK_ACCOUNT_ENCRYPTION_KEY`, `IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY`, `IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY_ID` |
| Jobs | `RECONCILIATION_CRON`, `WEBHOOK_QUEUE_NAME`, `DLQ_NAME`, `ADMIN_REVIEW_WEBHOOK_ALERT_CHANNEL` |
| VTpass | `VTU_PROVIDER`, `VTPASS_BASE_URL`, `VTPASS_API_KEY`, `VTPASS_PUBLIC_KEY`, `VTPASS_SECRET_KEY`, `VTPASS_WEBHOOK_SECRET` |
| Ninja KYC | `KYC_PROVIDER`, `NINJA_BASE_URL`, `NINJA_CLIENT_KEY`, `NINJA_CLIENT_SECRET` |
| FX | `FX_RATE_API_URL`, `FX_RATE_API_KEY` |

## Sandbox To Live Pattern

1. Keep live feature flags off: `BANKING_ENABLED=false`, `VIRTUAL_ACCOUNTS_ENABLED=false`, `WITHDRAWALS_ENABLED=false`, `BANKING_SANDBOX_MODE=true`.
2. Configure sandbox keys and webhook URLs in provider dashboards.
3. Run one complete sandbox happy path and one provider failure path for each feature.
4. Confirm idempotency by replaying the same request or webhook reference.
5. Confirm audit logs mask account numbers, OTPs, secrets, signatures, BVN, NIN, and tokens.
6. Switch to live keys in the production secret manager only after provider approval and compliance sign-off.
7. Set `BANKING_SANDBOX_MODE=false`, then enable only the approved feature flag.
8. Run a low-value live smoke test and reconcile it before increasing limits.

## Current Active Banking Decision

As of 2026-05-22, TRUSTPAY's active virtual-account path is:

- Monnify only.
- NGN only.
- No Nomba.
- No banking or payment fallback provider.
- Admin review required before Monnify-verified NGN exchange deposits credit GHS.

Treat older multi-provider notes as historical planning. `DOCS/PROVIDER-SOURCE-OF-TRUTH.MD` is authoritative.

## Global Verification Checklist

- [ ] Live secrets are present only in the secret manager or deployment platform.
- [ ] Production database requires SSL/TLS and has automated backups with restore testing.
- [ ] Redis requires authentication and is reachable only from trusted services.
- [ ] Webhooks use HTTPS public URLs and provider signature verification.
- [ ] Every mutation request uses `Idempotency-Key`.
- [ ] Wallet debits and credits are inside Prisma transactions.
- [ ] No protected route is reachable without `JwtAuthGuard` or equivalent Supabase auth guard.
- [ ] Admin routes require role authorization and audit logs.
- [ ] Sentry or equivalent error tracking is active for backend, web, and mobile.
- [ ] Reconciliation and dead-letter review have named owners.

## Global Launch Blockers

- Missing live provider approval, settlement account, or transfer permission.
- Any live secret committed to git, logged, or exposed through `NEXT_PUBLIC_*`.
- Weak JWT, Supabase, Redis, PII, or bank-account encryption secrets.
- Webhook signature verification not confirmed against the live provider.
- Reconciliation cannot explain wallet totals, provider totals, and ledger totals.
- Any unresolved path that can double-credit, double-debit, or create a negative balance.
