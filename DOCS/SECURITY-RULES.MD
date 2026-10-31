# TRUSTPAY Security Rules & Guidelines

> **MANDATORY**: These rules apply to ALL code written in this project. Every prompt, every PR, every phase must follow these rules. Violations must be flagged and fixed before proceeding.

---

## Table of Contents

1. [Idempotency & Duplicate Transaction Prevention](#1-idempotency--duplicate-transaction-prevention)
2. [Race Condition Prevention](#2-race-condition-prevention)
3. [Input Validation & Sanitization](#3-input-validation--sanitization)
4. [Authentication & Authorization](#4-authentication--authorization)
5. [Secrets Management](#5-secrets-management)
6. [Database Security](#6-database-security)
7. [API Security](#7-api-security)
8. [Webhook Security](#8-webhook-security)
9. [Logging & Audit](#9-logging--audit)
10. [Error Handling](#10-error-handling)
11. [Financial Data Integrity](#11-financial-data-integrity)
12. [Frontend Security](#12-frontend-security)
13. [Mobile Security](#13-mobile-security)
14. [Deployment & Infrastructure](#14-deployment--infrastructure)
15. [Pre-Commit Checklist](#15-pre-commit-checklist)

---

## 1. Idempotency & Duplicate Transaction Prevention

**Impact: CRITICAL** — Financial transactions must never be duplicated.

### Rules

**1.1** Every mutation endpoint (POST/PUT/PATCH) MUST accept an `Idempotency-Key` header.

**1.2** Store idempotency keys in the database or Redis with a TTL (minimum 24 hours).

**1.3** Before processing any transaction, check if the idempotency key already exists.

**1.4** If a duplicate key is found, return the **original response** (not a new transaction).

**1.5** Payment callbacks and webhooks MUST be idempotent by design — use `reference` or `transactionId` as the idempotency key.

### Implementation Pattern

```typescript
// Backend: Idempotency interceptor pattern
async function processWithIdempotency(key: string, fn: () => Promise<any>) {
  const existing = await prisma.idempotencyKey.findUnique({ where: { key } });
  if (existing) {
    return existing.response; // Return cached response
  }

  const result = await fn();

  await prisma.idempotencyKey.create({
    data: { key, response: result, expiresAt: new Date(Date.now() + 86400000) },
  });

  return result;
}
```

**1.6** Frontend MUST generate a UUID for each payment attempt and send it as `Idempotency-Key`.

**1.7** Disable payment buttons immediately after click (show loading spinner) to prevent double-taps.

---

## 2. Race Condition Prevention

**Impact: CRITICAL** — Concurrent requests must not cause double-spending or inconsistent balances.

### Rules

**2.1** All wallet balance modifications MUST use database-level locking (`SELECT ... FOR UPDATE`) or Prisma transactions.

**2.2** Balance deduction and credit must happen within a single ACID transaction.

**2.3** Never read-then-write wallet balances in separate queries.

**2.4** Use optimistic locking with a `version` column or Prisma transactions for concurrent operations.

### Implementation Pattern

```typescript
// Use Prisma transactions for all balance operations
async function deductBalance(userId: string, currency: string, amount: Decimal) {
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findFirst({
      where: { userId, currency },
    });

    if (wallet.balance.lt(amount)) {
      throw new BadRequestException('Insufficient balance');
    }

    return tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: amount } },
    });
  });
}
```

**2.5** Set a reasonable transaction timeout (5 seconds) to prevent deadlocks from hanging.

---

## 3. Input Validation & Sanitization

**Impact: CRITICAL** — Never trust user input.

### Rules

**3.1** ALL input MUST be validated using `class-validator` DTOs (backend) or Zod (frontend).

**3.2** Use `whitelist: true` and `forbidNonWhitelisted: true` in the global ValidationPipe.

**3.3** Sanitize and escape all user-provided values before rendering in the frontend.

**3.4** Validate phone numbers with E.164 format: `^\+?[1-9]\d{1,14}$`.

**3.5** Validate amounts: must be positive, non-zero, and within configured min/max limits.

**3.6** Limit input sizes: email (254 chars), phone (15 chars), text fields (500 chars).

**3.7** Validate currency codes against a whitelist (`NGN`, `GHS` only).

**3.8** Never use user input directly in SQL, file paths, or system commands.

---

## 4. Authentication & Authorization

**Impact: CRITICAL** — Protect user accounts and admin access.

### Rules

**4.1** Passwords MUST use bcrypt with cost factor ≥ 12.

**4.2** Access tokens expire in ≤ 15 minutes. Refresh tokens expire in ≤ 7 days.

**4.3** Refresh token rotation: invalidate old refresh token and issue a new one on each use.

**4.4** Implement account lockout after 5 failed login attempts (15-minute cooldown).

**4.5** OTP MUST expire within 5 minutes and allow maximum 3 verification attempts.

**4.6** All authenticated endpoints MUST use `JwtAuthGuard`.

**4.7** Admin endpoints MUST use `RolesGuard` with `@Roles('ADMIN')`.

**4.8** Implement session/device tracking: allow users to view and revoke active sessions.

**4.9** Rate limit authentication endpoints:
   - Login: 5 attempts per 15 minutes per IP
   - OTP send: 3 sends per hour per phone number
   - Password reset: 3 requests per hour per email

**4.10** JWT tokens MUST contain only non-sensitive claims (`sub`, `role`). Never include password, email in tokens.

---

## 5. Secrets Management

**Impact: CRITICAL** — Never expose secrets in code or logs.

### Rules

**5.1** NEVER commit `.env` files, API keys, or credentials to version control.

**5.2** Use `.env.example` as a template with placeholder values.

**5.3** Load secrets exclusively from environment variables (never hardcoded).

**5.4** Never log secrets, tokens, passwords, or API keys — even in debug mode.

**5.5** Use different keys for development, staging, and production environments.

**5.6** Rotate all API keys and secrets quarterly.

**5.7** Use a secrets manager (AWS Secrets Manager, Doppler, etc.) in production.

---

## 6. Database Security

**Impact: CRITICAL** — Protect sensitive financial data at rest.

### Rules

**6.1** Use Prisma ORM exclusively — no raw SQL unless absolutely necessary.

**6.2** If raw SQL is required, use parameterized queries ONLY.

**6.3** Implement Row-Level Security (RLS) for multi-tenant data isolation.

**6.4** Database credentials must use strong passwords and be rotated regularly.

**6.5** Enable SSL/TLS for all database connections in production.

**6.6** Never expose database errors to clients — return generic "Internal server error".

**6.7** Use database connection pooling to prevent connection exhaustion.

**6.8** Audit log all schema changes with migration files (never manual ALTER TABLE in production).

---

## 7. API Security

**Impact: HIGH** — Protect the API surface.

### Rules

**7.1** Enable CORS with explicit allowed origins — never `*` in production.

**7.2** Use Helmet for security headers (HSTS, X-Frame-Options, CSP, etc.).

**7.3** Implement rate limiting:
   - General: 100 requests per minute per IP
   - Auth endpoints: 5 per 15 minutes
   - Payment endpoints: 10 per minute
   - OTP endpoints: 3 per hour

**7.4** Use a global API prefix (`/api`).

**7.5** Return consistent error responses: `{ statusCode, message, timestamp, path }`.

**7.6** Implement request size limits to prevent payload attacks.

**7.7** Use HTTPS exclusively in production. Redirect HTTP to HTTPS.

**7.8** Implement API versioning (`/api/v1/...`) for backward compatibility.

---

## 8. Webhook Security

**Impact: CRITICAL** — Webhooks are the trust boundary with payment providers.

### Rules

**8.1** ALWAYS verify webhook signatures using the provider's secret key.

**8.2** Validate the webhook payload structure before processing.

**8.3** Webhook handlers MUST be idempotent — check transaction status before processing.

**8.4** Respond to webhooks quickly (within 5 seconds) and process asynchronously.

**8.5** Log all incoming webhooks (raw payload) for debugging and audit.

**8.6** Implement retry logic for failed webhook processing.

**8.7** Use a dead letter queue for webhook events that fail after max retries.

**8.8** Never trust the webhook amount — verify against your own records.

### Implementation Pattern

```typescript
@Post('webhooks/monnify')
async handleMonnifyWebhook(
  @Headers('monnify-signature') signature: string,
  @Req() request: RawBodyRequest<Request>,
  @Body() payload: MonnifyWebhookDto,
) {
  // 1. Verify signature
  const isValid = this.webhookService.verifyMonnifySignature(
    signature,
    request.rawBody,
  );
  if (!isValid) throw new BadRequestException('Invalid signature');

  // 2. Check idempotency
  const existing = await this.prisma.webhookLog.findUnique({
    where: { reference: payload.data.reference },
  });
  if (existing) return { received: true };

  // 3. Process asynchronously
  this.webhookProcessor.processPayment(payload.data);

  // 4. Log and return immediately
  await this.prisma.webhookLog.create({ data: { reference: payload.data.reference } });
  return { received: true };
}
```

---

## 9. Logging & Audit

**Impact: HIGH** — Every action must be traceable.

### Rules

**9.1** Log ALL financial transactions (create, update, status change) with:
   - User ID
   - Transaction ID
   - Amount and currency
   - Status before and after
   - Timestamp
   - IP address

**9.2** Never log sensitive data: passwords, tokens, card numbers, full account numbers.

**9.3** Use structured JSON logging (Pino) for all backend logs.

**9.4** Implement an audit trail table for all admin actions (rate changes, user suspension, etc.).

**9.5** Set up error tracking (Sentry) for both backend and frontend.

**9.6** Log rate limit triggers and authentication failures.

**9.7** Keep logs for a minimum of 90 days (or per regulatory requirements).

---

## 10. Error Handling

**Impact: HIGH** — Failures must be handled gracefully without exposing internals.

### Rules

**10.1** Use a global exception filter to catch all unhandled errors.

**10.2** Never expose stack traces or internal error details to clients in production.

**10.3** Return user-friendly error messages with actionable guidance.

**10.4** All payment-related errors MUST be logged with full context for debugging.

**10.5** Implement graceful degradation: if a service is down, return a clear error, not a crash.

**10.6** Use specific HTTP status codes:
   - `400` — Validation errors
   - `401` — Authentication required
   - `403` — Insufficient permissions
   - `404` — Resource not found
   - `409` — Conflict (duplicate email, duplicate transaction)
   - `422` — Business logic errors (insufficient balance)
   - `429` — Rate limited
   - `500` — Server error (never expose details)

**10.7** Implement circuit breaker pattern for external API calls (payment providers, VTU APIs).

---

## 11. Financial Data Integrity

**Impact: CRITICAL** — Money must always be accounted for.

### Rules

**11.1** Use `Decimal` type for ALL monetary values — never `Float` or `Number`.

**11.2** Never round financial values. Use proper decimal precision (2 decimal places for currency).

**11.3** All fee calculations MUST be performed server-side — never trust client-side calculations.

**11.4** Implement a double-entry bookkeeping pattern: every debit has a corresponding credit.

**11.5** Wallet balances MUST never go negative. Check balance before every deduction.

**11.6** All transaction status transitions must be validated:
   - `PENDING` → `SUCCESS` or `FAILED`
   - `PENDING` → `REVERSED` when the provider confirms reversal of reserved funds.
   - `SUCCESS` → `REVERSED` only after an authenticated, independently confirmed provider reversal; credit exactly one compensating ledger entry in the same database transaction.
   - Replayed or stale pending/failure events must never overwrite success or create another refund. Do not refund an already refunded `FAILED` or `REVERSED` transaction.
   - No other transitions are allowed without a documented product-specific state machine and financial regression coverage. The incoming Paystack checkout correction (`FAILED` → `SUCCESS` only after independent receipt verification and exactly-once credit) is defined in `DOCS/PAYSTACK-ACTIVATION.md` and covered by `paystack-funding.service.spec.ts`; it does not apply to withdrawals.

**11.7** Implement a daily reconciliation job to verify:
   - Sum of all wallet balances = expected total
   - All transactions have valid references
   - No orphaned transactions exist

**11.8** Never delete transaction records — use soft deletes or status updates only.

---

## 12. Frontend Security

**Impact: HIGH** — Protect the web application.

### Rules

**12.1** Never store JWT tokens in `localStorage` for sensitive operations. Use `httpOnly` cookies where possible, or secure memory storage.

**12.2** Implement CSRF protection for all state-changing requests.

**12.3** Sanitize all user-generated content before rendering (use DOMPurify if needed).

**12.4** Use Content Security Policy (CSP) headers.

**12.5** Never expose API secrets or keys in frontend code.

**12.6** Implement automatic logout after 15 minutes of inactivity.

**12.7** Mask sensitive data in the UI (partial phone numbers, partial account numbers).

**12.8** Use HTTPS for all API calls — never allow mixed content.

---

## 13. Mobile Security

**Impact: HIGH** — Protect the Flutter app.

### Rules

**13.1** Store JWT tokens in `flutter_secure_storage` — never in `SharedPreferences`.

**13.2** Implement certificate pinning for production builds.

**13.3** Enable Android `android:usesCleartextTraffic="false"` — no HTTP traffic.

**13.4** Implement biometric authentication option (fingerprint/face ID) for app access.

**13.5** Obfuscate production builds with R8/ProGuard.

**13.6** Implement jailbreak/root detection for sensitive operations.

**13.7** Never log sensitive data in production — use conditional logging based on build flavor.

---

## 14. Deployment & Infrastructure

**Impact: HIGH** — Secure the hosting environment.

### Rules

**14.1** All services MUST run behind HTTPS with valid SSL certificates.

**14.2** Use separate databases for development, staging, and production.

**14.3** Implement WAF (Web Application Firewall) rules in production.

**14.4** Regular dependency updates — no known CVEs in any package.

**14.5** Use container health checks for all services.

**14.6** Implement automated backups with daily frequency and 30-day retention.

**14.7** Use environment-specific configurations — never share configs across environments.

---

## 15. Pre-Commit Checklist

Before committing ANY code, verify:

### Security
- [ ] No hardcoded secrets, API keys, or passwords
- [ ] All user input is validated
- [ ] No SQL injection risks (use Prisma exclusively)
- [ ] No XSS risks (sanitize output)
- [ ] Auth guards are in place on protected routes
- [ ] Rate limiting is applied to sensitive endpoints

### Financial Integrity
- [ ] All monetary values use `Decimal` type
- [ ] Balance operations use Prisma transactions
- [ ] Idempotency keys are implemented for mutations
- [ ] No negative balance scenarios possible
- [ ] Fee calculations are server-side only

### Code Quality
- [ ] Proper TypeScript types on all functions
- [ ] Error handling with appropriate HTTP status codes
- [ ] Logging for all significant operations
- [ ] No console.log in production code
- [ ] Tests cover new functionality

### Architecture
- [ ] Follows module separation (auth, users, wallets, etc.)
- [ ] DTOs for all input/output
- [ ] Guards for protected routes
- [ ] Services contain business logic, controllers only handle routing

---

## Severity Levels

| Level | Description | Examples | Action |
|-------|-------------|----------|--------|
| **CRITICAL** | Security vulnerability, financial data loss | Duplicate transactions, auth bypass, SQL injection | BLOCK — fix immediately |
| **HIGH** | Performance issue, correctness bug | Race conditions, N+1 queries, missing validation | FIX before merge |
| **MEDIUM** | Maintainability, code quality | Missing types, poor naming, missing tests | Fix or accept with TODO |
| **LOW** | Style, minor improvements | Formatting, comment updates | Optional |

---

## Review Process

Every code change MUST be reviewed against this checklist:

1. **Security First** — Check for vulnerabilities (idempotency, auth, injection)
2. **Financial Integrity** — Verify money handling (decimals, transactions, no negatives)
3. **Performance** — Check for N+1 queries, missing indexes, inefficient logic
4. **Correctness** — Verify error handling, edge cases, validation
5. **Maintainability** — Check types, naming, modularity
6. **Testing** — Ensure tests exist for new code

---

*Last updated: 2026-10-30 — Paystack migration, verified incoming-checkout correction and secure mobile checkout recovery reviewed*
*This document MUST be reviewed and updated at the end of each phase.*

### 2026-10-31 mobile identity and receiving-account review

The Flutter account request flow retains authenticated backend eligibility checks and explicit account-setup consent. Provisioning and KYC retries retain their idempotency keys for uncertain outcomes; definite client rejections allow a new attempt. Identity request fingerprints are hashed in memory, bank details remain masked on review, and NIN approval remains an audited staff action. No balance, tier, provider-signature, or backend authorization rules were changed by this UI repair.

### Kora Ghana phase — 31 October 2026

Reviewed additive GHS account/collection/exchange/withdrawal paths against this checklist. Provider callbacks require data-object HMAC verification, validated event envelopes and a durable inbox; only safe identifiers are retained in that inbox, with financial details independently queried. Full provider account/phone data, OTPs, PINs and secrets must not enter logs. Wallet/order allocation and payout compensation use exact Decimal values and serializable ledger transactions. Admin release and customer mutations retain authentication, roles, rate limits and idempotency.

The independent integration review's five Important recovery/queue findings were fixed with regression tests. Configuration and a balance response remain distinct from merchant activation; Kora is disabled by default. Actual signed sandbox fixtures, supported recipient verification, merchant product/corridor approval, provider liquidity and live reconciliation remain acceptance gates. See `DOCS/KORA-GHANA-SETUP.md` and the phase verification record.


### 2026-10-31 mobile send-money review

The Flutter transfer refactor preserves authenticated recipient lookup, server-verified transaction PINs, KYC tiers, exact decimal payloads, durable idempotency keys, and read-only outcome resolution. Grouped amount entry and naira/kobo or cedi/pesewa descriptions use integer minor units. Failed storage preflight blocks submission; PIN verification disables further keypad input; uncertain requests retain their original attempt. Startup recovery now reports terminal outcomes and pauses new review when an earlier payment has just resolved. The loading and preflight guards apply to all journal-backed payment operations, including shared VTU purchases.

Receipts use authoritative transfer responses, verify requested references (including transaction-reference aliases), distinguish completed reversals from the original successful status, and exclude wallet balances and unmasked recipient identifiers from exports. No backend mutation, ledger, provider-signature, authorization, fee, or balance rule was changed. UI verification uses simulated API responses; no live financial transaction was performed.

Validation for the mobile send-money phase: all 359 Flutter tests passed, analyzer reported no issues, and whitespace checks passed. Phone/dark/150% text layouts were rendered and inspected.

### Interim manual exchange admin triggers — 31 October 2026

GHS→NGN uses the existing exact-once, receipt-backed NGN wallet credit action after an admin checks actual cedi receipt. The new NGN→GHS external completion action requires the assigned payout operator, a previously confirmed deposit, the exact frozen cedi amount, a unique transfer reference and protected payout proof. It atomically records completion and parent transaction success without any additional wallet movement or provider request. Existing guards, DTO validation, rate limits, idempotency, serializable/version checks, settlement holds and financial audits are retained. Kora remains disabled; no live transfer or deployment is performed. Operator instructions are in `DOCS/MANUAL-EXCHANGE-ADMIN-TRIGGERS.md`.

The manual-trigger review additionally required server-owned workflow isolation and storage-independent committed replay. Migration `046_manual_admin_payout_workflow` preserves existing orders as LEGACY; newly created NGN→GHS external orders use ADMIN_CEDIS and cannot use the legacy Mark sent/Complete shortcut. Committed review events are checked before downloading evidence again, while new actions still verify protected proof. Regressions were observed failing and passing for both findings. Migration was applied only to the disposable financial test database.


### 2026-10-31 KYC personal-details repair

The mobile BVN flow now loads the authenticated saved profile, validates legal names and Nigerian phone format before bank/identity collection, and saves changed name, phone, country and reviewed birth year through the existing audited profile endpoint before KYC. Profile saves use their own idempotency attempt; an uncertain save is reconciled by reading the profile on retry. Unchanged profiles avoid unnecessary mutations, and verified/previously edited profiles retain server correction restrictions. Failed saves prevent the KYC request. Review masks the phone and preserves identity/bank input when editing. No real identity check or account creation was submitted during verification.

Definitive Paystack identification HTTP 400/422 failures release only the matching pending verification/fingerprint and mark its non-verified binding failed, with an audit record. Ambiguous transport, authentication, rate-limit and unknown failures remain pending. Conditional transitions preserve a concurrent verified webhook result and retain canonical callback correlation. Upstream exception metadata contains only the HTTP status, never provider payloads or PII.

Validation for KYC personal-details repair: 376 Flutter tests and 618 backend tests passed; backend build passed. KYC analysis is clean; the whole-app analyzer has only four unrelated manual-exchange style infos. The unknown-attempt regression confirms profile-read rejection does not rotate an uncertain KYC key. No live identity submission was performed.


### Exchange flow and codebase hardening — 31 October 2026

New exchange creation now enforces the approved delivery matrix on the server and publishes it to mobile: GHS→NGN wallet, NGN→GHS bank/MoMo. Stored historical idempotent replay remains ahead of this new policy and cannot change original terms. Payout ownership now rechecks customer eligibility, PIN reset hold and both settlement currency holds transactionally before any external-payment instruction becomes actionable. Existing Decimal ledger movement, DTOs, JWT/ADMIN guards, throttling, proof verification, deposit uniqueness and financial audits remain in place.

The ADMIN queue adds bounded pages, validated UUID cursors and global counts in a RepeatableRead snapshot. Strict creation-time/ID keyset boundaries prevent status-changing cursor rows from skipping unpaid obligations. Admin caches are scoped to the authenticated account; automatic refresh is budgeted by loaded page count and stale data remains visibly marked on refresh failure. Definitive 400/401/403/404/422 failures can start a corrected admin attempt; conflicts, rate limits and uncertain outcomes retain their original idempotency key. Ghana receiving enablement alone cannot activate provider exchange, while historical provider recovery remains reachable.

Both Important independent-review findings (filtered pagination omission and deep-page polling throttling) were reproduced failing and verified passing after fixes. Final backend suite: 88 suites/619 tests; real PostgreSQL manual financial suite: 20 tests. Flutter: 377 full-suite tests, plus the final eight-case manual screen run including 150% phone text. Backend/web TypeScript, scoped ESLint and Flutter analysis are clean. Browser verification and the detailed record are in `DOCS/EXCHANGE-FLOW-REVIEW-2026-10-31.md`. No live funds, provider activation or production migration/deployment were performed; existing migration 046 remains a release prerequisite.


### 2026-10-31 KYC review experience

The Flutter review redesign separates submission acknowledgement, per-document status, and verification history. NIN evidence can be offered after BVN submission because the existing authenticated manual-review endpoint already permits it; evidence selection, explicit consent, upload bounds, idempotency and audited approval remain unchanged. No tier or receiving-account eligibility rule is modified. Legacy document status stays readable while new Paystack enrollment is a separate prerequisite for receiving-account setup.

Accepted local outcomes remain visible through stale or partial reads until the server acknowledges them; explicit server failures/revocations and server-owned tiers take precedence. Status checks are read-only, serialized per sheet, and preserve cached information after network failure. Canonical references reused by retries do not hide newly accepted results. NIN entry is masked with keyboard suggestions and autocorrect disabled. Illustrations are local, static SVG assets with no external requests. No real identity submission or financial account creation was performed for this UI verification.

KYC review experience validation: all 400 Flutter tests passed, analyzer reported no issues, whitespace checks passed, and responsive light/dark/150% text layouts were rendered and inspected. Independent review findings were covered by canonical-retry, legacy-status, NIN-privacy and stale-read regressions.
