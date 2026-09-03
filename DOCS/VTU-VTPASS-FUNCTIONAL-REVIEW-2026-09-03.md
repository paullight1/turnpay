# VTpass VTU Functional Review

Review date: 2026-09-03
Scope: TRUSTPAY backend, customer website, admin website, Flutter app, database,
deployment configuration, and operational recovery for VTpass VTU.

## Outcome

The repository implementation is complete for the approved Nigeria-only scope:
airtime, data, cable change/renew, and prepaid/postpaid electricity. All other
visible markets are disabled as `Coming soon`. Automated unit, build, browser,
mobile, schema, manifest, and real-PostgreSQL financial checks pass.

Production launch is not yet certified. It remains blocked on human-controlled
VTpass credentials, the trusted callback gateway, provider-funded balance and
commercial approval, and execution of the documented sandbox/live smoke
matrix. No real VTpass purchase was made during this review.

## Functional evidence

| Area | Result | Evidence |
| --- | --- | --- |
| Provider contract | Pass | VTpass-only provider/service mapping, auth headers, variation lookup, `/pay`, `/requery`, cable modes, meter types, normalized statuses, fail-closed simulation tests |
| Customer validation | Pass | Smart-card and meter DTOs use POST bodies; purchase repeats server-side verification and rejects invalid package/renewal prices |
| Financial integrity | Pass | Decimal money, conditional wallet debit in a Prisma transaction, non-negative balance guard, guarded terminal transitions, exactly-once reversal |
| Idempotency | Pass | Global mutation interceptor plus durable unique callback inbox; real PostgreSQL replay returned the original order/transaction response without a second provider call |
| Callback handling | Pass with external gate | HMAC raw-body verification, no query token, known-status validation, durable redacted inbox, retry/backoff, admin failure queue |
| Receipts and privacy | Pass | Purchased code encrypted at rest and returned only to the authenticated owner; targets masked; raw provider/callback data excluded from admin output |
| Website | Pass | Nigeria flows, customer verification, exact request shapes, pending/requery state, purchased-code receipt, future markets disabled |
| Flutter | Pass | Nigeria-only provider calls, cable/electricity modes, idempotency keys, pending tracking, receipt token, no runtime international catalogue calls |
| Admin operations | Pass | Provider health/balance, stale queue, cost/commission/fee/margin, reconciliation exceptions, redacted callback retries, audited reason-required requery |
| Deployment | Pass with external gate | Production manifests use `https://vtpass.com/api`; production rejects simulation and incomplete VTpass configuration |

## Verification results

- Backend: 63 suites, 443 tests passed.
- VTU-focused backend: 9 suites, 69 tests passed.
- Admin service: 27 tests passed.
- Real PostgreSQL VTU financial E2E: 1 test passed, including concurrent debit,
  idempotent replay, and duplicate reversal delivery.
- Backend Nest production build: passed.
- Prisma migration deployment to disposable PostgreSQL: 38 migrations applied;
  schema validation passed.
- Website ESLint and Next.js production build: passed.
- Website VTU Playwright journey: 1 passed in isolated CI mode.
- Flutter: 110 tests passed; analyzer reported no issues.
- Production manifest validation: passed.

The repository-wide standalone `tsc --noEmit` command still reports unrelated
test-fixture typing issues in health, KYC, and internal-transfer specs. The
Nest production build and all Jest suites pass, and no VTU-owned TypeScript
diagnostic remains.

The whole-tree `git diff --check` command is also tripped by pre-existing CRLF
lines in the already-modified `BACKEND/package-lock.json`. The VTU-scoped diff
check passes; the lockfile was left untouched to avoid rewriting unrelated
user work.

## Security checklist review

- Protected VTU routes use `JwtAuthGuard`; the webhook is intentionally public
  and authenticates the raw body before parsing its event into the inbox.
- All mutation routes require idempotency keys through the global interceptor;
  callback idempotency is database-enforced.
- Wallet debits and reversals use `LedgerService` inside Prisma transactions.
- DTO validation constrains provider, service, phone, subscription, and meter
  input. Server responses, not client values, control package and renewal
  amounts.
- Secrets are configuration-only. Logs contain references, masked targets, and
  redacted errors, not keys, full customer identifiers, raw callbacks, or
  purchased codes.
- The callback inbox has row-level security enabled and client roles revoked.
- Sensitive operations are rate-limited; admin manual requery requires a reason
  and writes an audit log.

## Required external certification

1. Install dedicated sandbox credentials in a secret manager.
2. Configure the trusted callback ingress to validate the upstream request and
   HMAC-sign the unchanged body for TRUSTPAY.
3. Execute every scenario in `PRODUCTION-GUIDES/08-VTU.MD`, including delayed,
   duplicate, unknown, refunded, and reversed cases.
4. Reconcile provider cost/commission, customer debit/fee, wallet, ledger,
   order, and owner receipt for every smoke transaction.
5. Confirm low-balance alerting and incident ownership.
6. Obtain engineering, security, finance, operations, and support go/no-go
   approval before setting `VTU_ENABLED=true` for customers.
