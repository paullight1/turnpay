# TRUSTPAY Send-Money Transaction Security Review

Date: 2026-05-28
Scope: `BACKEND/src/transfers`, wallet ledger posting, payment withdrawal flow, idempotency, transaction PIN, schema constraints, and relevant production-readiness docs.

## Remediation Status

Implemented on 2026-05-28:

- Added internal transfer attempt logging and per-user/currency daily/monthly usage tracking.
- Enforced Tier 2/Tier 3 internal transfer limits before wallet movement.
- Linked internal transfer `Transaction` rows to wallet IDs after ledger posting.
- Replayed failed idempotent responses instead of returning a misleading in-progress conflict.
- Split transaction PIN setup from reset; reset requires current PIN or OTP, writes audit logs, and applies a reset hold.
- Removed user-supplied payment callback URLs and mapped provider amounts with Decimal-safe helpers.
- Made withdrawal reset accounting use a conditional reset before atomic limit increment.

Verification:

- `npx prisma validate` passed.
- `npx prisma generate` passed.
- `npx tsc --noEmit` passed.
- Focused tests passed: 8 suites, 51 tests.

Known unrelated repo checks:

- Full `npm test -- --runInBand` still has 2 failing pre-existing/non-touched areas: `exchange.service.spec.ts` manual Monnify exchange deposit expectation and `banking.service.spec.ts` virtual-account select expectation.
- Full `npm run lint` still has unrelated existing errors under VTU provider code. Touched-file lint has no errors.

## Executive Summary

Focused unit tests for the current transfer, ledger, idempotency, deposit, and withdrawal logic pass. The internal transfer debit/credit path is materially safer than a naive balance update because it uses a Prisma transaction and atomic debit guard.

The main remaining risks are not basic CRUD bugs. They are production money-movement controls: internal transfers do not enforce the documented per-transaction/daily/monthly limits, transaction PIN setup can be overwritten with only a valid JWT, failed idempotent requests become permanently blocked instead of replaying the original failure, and failed/unknown transfer events are not consistently represented in a user-support-friendly status history. These gaps matter for hacked accounts, repeated send attempts, support investigations, and AML review.

## What Passed

- `npm test -- --runInBand transfers/transfers.service.spec.ts wallets/ledger.service.spec.ts common/interceptors/idempotency.interceptor.spec.ts payments/payment.service.withdraw.spec.ts payments/payment.service.deposit.spec.ts`
- Result: 5 test suites passed, 25 tests passed.
- `npm audit --omit=dev`
- Result: 11 moderate vulnerabilities via `qs`/`body-parser`/`express`; no fix available from npm audit at this dependency graph.

## Critical Findings

### 1. Internal Transfers Ignore Documented KYC-Tier Limits

Severity: Critical

Location:
- `BACKEND/src/transfers/transfers.service.ts:31`
- `BACKEND/src/transfers/transfers.service.ts:35`
- `DOCS/REALTIME-BANKING/PHASE-01/02-COMPLIANCE-KYC-AML-GATING-MATRIX.MD:22`
- `DOCS/TASKS.MD:95`

Evidence:
- The code only checks `amount > 0` and `amount <= 10_000_000`.
- The documented internal transfer policy says Tier 2 should be capped at NGN 250,000 per transaction, NGN 1,000,000/day, and NGN 5,000,000/month, with Tier 3 higher limits.
- `DOCS/TASKS.MD` still has “Add configurable transaction limits by KYC tier, currency, route, and time window” unchecked.

Impact:
An attacker with a compromised account and transaction PIN can drain up to the available balance in large or repeated sends, limited mainly by a 5/minute route throttle and wallet balance.

Fix:
Add a transaction-limit model keyed by route/currency/KYC tier, then enforce per-transaction, daily, monthly, and velocity windows inside the same Prisma transaction that posts the sender debit and recipient credit.

## High Findings

### 2. Transaction PIN Can Be Reset With Only A Valid JWT

Severity: High

Location:
- `BACKEND/src/auth/auth.controller.ts:107`
- `BACKEND/src/auth/auth.controller.ts:115`
- `BACKEND/src/auth/auth.service.ts:233`
- `BACKEND/src/auth/dto/auth.dto.ts:85`

Evidence:
- `POST /auth/transaction-pin` is JWT-protected, but the DTO only accepts `pin`.
- The service calls `setPin(userId, pin)` directly. There is no current PIN, password, OTP, device challenge, or cooldown check.

Impact:
If a session token is stolen, the attacker can set or replace the transaction PIN and immediately initiate protected money movement.

Fix:
Split PIN setup from PIN reset. Setup should only be allowed once or require recent OTP/password verification. Reset should require current PIN or step-up authentication, log an audit event, and apply a short transfer hold after reset.

### 3. Idempotency Records For Failed Requests Block Retries With The Same Key

Severity: High

Location:
- `BACKEND/src/common/interceptors/idempotency.interceptor.ts:143`
- `BACKEND/src/common/interceptors/idempotency.interceptor.ts:147`
- `BACKEND/src/common/interceptors/idempotency.interceptor.ts:201`
- `BACKEND/src/common/interceptors/idempotency.interceptor.ts:205`

Evidence:
- Failed requests are persisted as `status: "FAILED"`.
- `resolveExistingRecord` only returns cached responses for `"COMPLETED"` and throws “already in progress” for every other state, including `"FAILED"`.

Impact:
Users who hit a validation, provider, or transient server failure cannot safely retry with the same idempotency key. Support will see a confusing “in progress” state for a request that already failed.

Fix:
Persist structured failed responses and return the original failure for the same request hash, or allow a controlled retry state for failures that occurred before money movement began. Distinguish `FAILED_FINAL`, `FAILED_RETRYABLE`, and `IN_PROGRESS`.

### 4. Internal Transfer Has No Explicit Failure/Attempt Record

Severity: High

Location:
- `BACKEND/src/transfers/transfers.service.ts:73`
- `BACKEND/src/transfers/transfers.service.ts:74`
- `BACKEND/src/transfers/transfers.service.ts:110`
- `BACKEND/src/transfers/transfers.service.ts:125`
- `BACKEND/prisma/schema.prisma:210`
- `BACKEND/prisma/schema.prisma:269`

Evidence:
- Internal transfers create `Transaction` rows and ledger entries only inside the successful transaction.
- If a recipient lookup, KYC check, insufficient balance, validation failure, or unexpected error occurs before commit, there is no durable transfer attempt or failed transaction record.

Impact:
Support and fraud teams cannot reliably answer “why did my send fail?” or detect repeated failed probing attempts against recipient identifiers or balances.

Fix:
Add an `InternalTransferAttempt` or generalized `MoneyMovementAttempt` record with status, reason code, idempotency key, safe recipient identifier type, and masked identifier. Write final failure reasons without leaking sensitive data.

### 5. Withdrawal Limit Reset Is Race-Prone Around Month Boundary

Severity: High

Location:
- `BACKEND/src/payments/payment.service.ts:434`
- `BACKEND/src/payments/payment.service.ts:438`
- `BACKEND/src/payments/payment.service.ts:474`

Evidence:
- The code reads `limitResetDate`, conditionally resets counters, then uses atomic `updateMany` checks for the withdrawal amount.
- Two concurrent requests around reset time can both decide `needsReset` and both reset counters before incrementing.

Impact:
At the reset boundary, concurrent withdrawals may undercount usage and allow more withdrawals than intended.

Fix:
Use a single conditional update for reset, or move user limit enforcement into a dedicated locked/optimistic-versioned row. Include `limitResetDate` or a `version` predicate in the update.

## Medium Findings

### 6. Internal Transfers Do Not Write `walletId` Onto Transaction Rows

Severity: Medium

Location:
- `BACKEND/src/transfers/transfers.service.ts:74`
- `BACKEND/src/transfers/transfers.service.ts:92`
- `BACKEND/prisma/schema.prisma:213`

Evidence:
- The withdrawal transaction writes `walletId`; internal transfer transactions do not.

Impact:
Ledger entries remain linked to wallets, but transaction-list queries and support tooling have to join through ledger metadata instead of using the first-class transaction wallet relation.

Fix:
Resolve sender and recipient wallet IDs in the transaction and set `walletId` on both transaction rows.

### 7. `amount.toNumber()` Is Used For Provider Calls

Severity: Medium

Location:
- `BACKEND/src/payments/payment.service.ts:74`
- `BACKEND/src/payments/payment.service.ts:86`
- `BACKEND/src/payments/payment.service.ts:562`
- `BACKEND/src/payments/payment.service.ts:572`

Evidence:
- The database uses `Decimal`, but provider requests convert amounts to JavaScript number.

Impact:
The current max amount and two-decimal validation reduce practical risk, but money code should avoid number conversion at trust boundaries. Provider units can also differ, as seen with Paystack deposit verification dividing kobo by 100.

Fix:
Create provider-specific amount mappers that accept `Decimal`, validate scale, and output exact minor-unit integers or strings as required by each provider.

### 8. Fund Wallet Accepts Arbitrary Callback URLs

Severity: Medium

Location:
- `BACKEND/src/payments/dto/payment.dto.ts:45`
- `BACKEND/src/payments/dto/payment.dto.ts:48`
- `BACKEND/src/payments/payment.service.ts:62`

Evidence:
- `callbackUrl` is only a string with max length.
- The value is sent to the payment provider as the redirect/callback URL.

Impact:
This can enable open redirect/phishing flows through trusted payment pages or provider dashboards.

Fix:
Remove client-supplied callback URLs for normal users, or allowlist same-origin frontend callback paths and construct the full URL server-side.

### 9. Dependency Audit Has Moderate DoS Advisory

Severity: Medium

Location:
- `BACKEND/package-lock.json`

Evidence:
- `npm audit --omit=dev` reports `qs` advisory `GHSA-q8mj-m7cp-5q26` through Express/body-parser/Nest platform dependencies.

Impact:
Remote DoS potential in vulnerable transitive dependency paths, depending on reachable parsing options.

Fix:
Track upstream Nest/Express/body-parser releases. Keep request body limits low and avoid enabling vulnerable query/body parser options.

## Positive Controls Observed

- `BACKEND/src/transfers/transfers.controller.ts:9` protects transfer routes with `JwtAuthGuard`.
- `BACKEND/src/transfers/transfers.controller.ts:14` rate-limits internal sends.
- `BACKEND/src/transfers/transfers.service.ts:73` wraps internal transfer rows and wallet movements in a Prisma transaction.
- `BACKEND/src/wallets/ledger.service.ts:50` uses `updateMany` with `balance >= amount` before debit, preventing straightforward double-spend.
- `BACKEND/src/common/interceptors/idempotency.interceptor.ts:36` requires idempotency on state-changing non-auth, non-webhook routes.
- `BACKEND/src/payments/webhooks/payment-webhook.controller.ts:102`, `:150`, and `:221` verify provider webhook signatures.

## Recommended Next Fix Order

1. Implement internal transfer limits and velocity controls inside the transfer transaction.
2. Harden transaction PIN reset with step-up verification and post-reset transfer hold.
3. Fix failed idempotency semantics so retries/support states are accurate.
4. Add durable internal transfer attempt/failure records with reason codes.
5. Add focused tests for concurrent internal transfers, limit exhaustion, failed idempotent retries, PIN reset abuse, and month-boundary withdrawal limits.
