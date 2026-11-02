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
   - OTP send: 3 sends per hour per normalized email address
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

**9.5** Keep structured error logging and operational audit records enabled. Sentry is optional for now, as explicitly directed by the owner on 31 October 2026; enable it only when a valid DSN is configured.

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

**13.2** Implement certificate pinning for production builds. Owner-approved exception on 1 November 2026: the Android internal-testing build may use standard certificate and hostname validation against the production API while Render manages certificate rotation. This exception does not authorize a public production release; review the transport policy and rotation plan before production promotion.

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

### 2026-10-31 KYC delivery and reviewer activation

Manual NIN submissions and admin decisions now serialize on the same user-first PostgreSQL row lock as Paystack identity finalization. Reviews reread pending state and the current tier inside the transaction; terminal decisions cannot be replaced by a competing reviewer. No provider-owned BVN decision or existing tier requirement was relaxed. A server-only first-admin command defaults to dry run, requires an explicitly selected existing confirmed and active auth identity, refuses a second administrator, and records the role assignment atomically under serializable isolation. It creates no passwords and never infers privileges from email domains or customer metadata. Runtime auth continues to check the database role.

Verification: 627 backend unit tests passed; six KYC API cases passed against disposable local PostgreSQL with real guards, validation, database idempotency, signature checks, webhook inbox/worker and audits. Delayed provider responses use the same user-first lock and fresh account state, preserving independently earned tiers. Auth/provider/storage boundaries were faked for those cases; live approval and delivery are not certified. Backend build and targeted ESLint passed. Live configuration remains pending the owner's dashboard access, server storage credential and designated reviewer. No genuine verification outcome, tier or role was manually changed during setup.

Activation follow-up: the owner nominated an existing reviewer, but email confirmation remains required and the bootstrap correctly refused promotion. A fresh confirmation email was sent only after explicit owner instruction. The existing Render storage credential was matched to the same Supabase project and installed only in the ignored local server configuration with mode 0600; temporary secret files were removed. A synthetic private-storage upload/read test passed, anonymous access was denied, and the fixture was removed. The previously empty Paystack Live webhook was saved to the canonical TRUSTPAY API URL and persistence verified. Delivery remains unverified because the new deployed release fails its mandatory configuration checks. No production guard was disabled, no real KYC result was approved, and the approved Render Paystack-key transfer was not performed after browser control disconnected.

Reviewer activation follow-up: after Supabase confirmed the nominated account's email, the owner-authorized first-admin command completed its dry run and applied the ADMIN role. An independent database read confirmed the active role and exactly one provisioning audit. This access assignment did not verify an identity document or change any KYC tier. Render configuration and delivery remain pending unavailable browser control and deployment credentials; no startup security or monitoring requirement was bypassed.

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


### 2026-10-31 email OTP and optional Sentry follow-up

At the owner's explicit instruction, Sentry is optional in backend startup and mobile release builds; supplied DSNs retain HTTPS/host validation, and structured logging/audit remain enabled. Customer OTP delivery/verification uses Supabase email rather than Twilio. DTOs validate normalized email plus six digits; existing auth idempotency policies remain in force. Redis bounds each challenge to five minutes and three provider attempts, atomically consumes success and prevents late results from deleting a newer challenge. Provider tokens/sessions are not exposed by the OTP API; SDK clients have isolated state. Email verification grants no phone or KYC verification. Authenticated PIN reset binds its code to the saved email and preserves security holds. Live email acceptance still requires verified SMTP/template settings and genuine provider delivery; no live verification was fabricated.


### Exchange functional QA and supported home currencies — 1 November 2026

Exchange verification passed 88 focused unit/controller, 37 real-PostgreSQL financial and 29 HTTP contract tests using synthetic fixtures and faked external boundaries. Flutter exchange/home checks passed 43 tests; the final home cleanup rerun passed eight tests and analysis is clean. Browser checks exercised 26 desktop/mobile scenarios; the one initial mobile navigation failure was an assumption that the desktop sidebar was visible. The test now opens the phone menu, and targeted desktop/mobile reruns passed. A separate failing named-dialog assertion verified the missing menu accessibility title before adding a visually hidden title/description; the final two-browser-case run passed with web types and scoped lint clean.

The requested unsupported-currency home section and its local preferences/unused cards were removed. NGN/GHS cards, balance privacy, account setup, transaction navigation and server balances remain intact. The UI change does not delete wallet/account records; no financial or authorization policy was relaxed, and no production flags or provider credentials were changed. The local manual exchange path is disabled with receiving details absent; the actual app correctly blocks new requests. Kora remains unactivated. One unrelated in-progress KYC recovery assertion failed in the broad backend run and is explicitly documented; the whole backend is not claimed green. No live transfer, genuine identity submission, deployment or push was performed. See `DOCS/EXCHANGE-FUNCTIONAL-QA-2026-11-01.md` for boundaries and evidence.


### Manual exchange receiving-account activation — 1 November 2026

At the owner's request, the supplied dedicated NGN and GHS merchant receiving details were configured only in the ignored mode-0600 local environment, after explicit confirmation of the MoMo recipient name. A read-only lookup found no overlap with a customer virtual account. The API now reports direction-specific receiving readiness without exposing the account data, and Flutter validates the capability before enabling a direction or swap. Existing create/replay guards, KYC/PIN, Decimal/fresh-rate checks, settlement holds, proof requirements, deposit allocation and financial audits remain authoritative. No wallet balance or live payment was changed.

Readiness/direction regressions were observed failing and passing. Verification: 673 backend tests, 417 Flutter tests and 20 disposable-PostgreSQL financial tests passed; backend build, scoped ESLint and Flutter analysis passed. A separate whole-repository TypeScript check reports pre-existing KYC/OTP test-mock errors, documented in `DOCS/EXCHANGE-ACTIVATION-2026-11-01.md`. The actual preview now opens both directions. No live FX API is configured, so the stale fallback remains display-only and cannot authorize an order; approved rate/feed setup is pending the owner's answer. Kora and production deployment remain unchanged.


### Admin-controlled exchange prices — 1 November 2026

The owner selected admin-set rates. `FX_RATE_SOURCE=admin` is now the validated default; authoritative reads require an active positive admin rate for the exact direction and never substitute provider/cache/fallback data. Admin prices retain explicit expiry validation but are not subject to the API feed's 60-second freshness window. API mode remains explicit and preserves its existing safeguards. Startup/cron cannot overwrite rates in admin mode. Read-only missing-rate metadata contains null prices and enables honest customer/admin empty states; order creation still rejects absent rates.

The existing rate-save endpoint retains JWT/ADMIN guards, DTOs, throttling, idempotency and transactional override audits. Decimal financial calculations, KYC/PIN, settlement holds, deposit/proof controls and frozen order amounts remain unchanged. No actual commercial price or live payment was submitted. A disposable-PostgreSQL lifecycle regression verifies that changing the admin price after order creation does not change the exact-once wallet credit.

Validation: 683 backend tests, 419 Flutter tests and 26 disposable-PostgreSQL financial tests passed. The final mobile consumer rerun passed 16 tests; Flutter analysis, backend production build, final scoped backend/web ESLint and web TypeScript checks passed. Mocked desktop/mobile admin first-price setup passed two browser cases. Details and operator instructions are in `DOCS/ADMIN-EXCHANGE-RATES-2026-11-01.md`. Local private configuration uses admin mode; no production deployment or Git push occurred.


### Exchange amount-page UI refactor — 1 November 2026

The mobile amount screen now keeps NGN/GHS codes and full currency names visible, separates send/estimated receive amounts, names the direction, enlarges touch targets and uses plain payment-review copy. A read-only Check rate action reloads the preview while preserving the source draft; existing generation checks reject late results. It neither saves a commercial rate nor creates an order. Exact rational preview arithmetic, source validation, configured/stale metadata, server quote authority, KYC/PIN, durable idempotency and settlement controls remain intact. The old whole-unit amount-in-words captions were removed rather than suggesting fractional amounts were whole numbers.

Verification: the new draft-preserving rate-retry regression failed before implementation and passed afterward. All 31 scoped exchange converter/screen/service tests passed, including 320px dark mode with 150% text, phone/desktop entry and existing recovery/receiving paths; Flutter analysis reported no issues. Initial form-navigation test taps were outside a 600px test viewport; the tests now scroll to the action before tapping. No live financial mutation, production deployment or Git push was performed.


### Exchange header back navigation — 1 November 2026

The footer Back button was moved to the existing arrow beside the Exchange header title. It returns one exchange step while preserving the draft; at the chooser, the existing route-level navigation policy remains. Step-back is unavailable during submission or unresolved create recovery, and a stale handler cannot decrement below the chooser. No shared header component, financial calculation, API, provider, KYC/PIN, idempotency or audit behavior changed.

The header navigation regression was reproduced against the previous UI and passed with the change. All 17 scoped screen/converter tests passed; final scoped Flutter analysis reported no issues. No order, payment, commercial rate save, production deployment or Git push was submitted.


### Admin exchange-rate navigation — 1 November 2026

The Exchange rates menu destination now renders the existing audited editor above the exchange queues, as well as on Overview. Live admin inspection initially showed both directions unset; the old values matched the sample system rates in the seed file. No sample rate was promoted. The owner subsequently saved a price themselves. Existing DTO, JWT/ADMIN, idempotency, transactional audit and rate-source controls remain authoritative.

Desktop regression reproduced the missing editor. The corrected browser run reported two passed desktop/mobile scenarios using synthetic prices; the runner was interrupted during stalled teardown (exit 130), so a clean overall runner exit is not claimed. Actual phone-size signed-in admin inspection confirmed the editor and empty state. Web TypeScript, scoped ESLint and whitespace checks passed. No agent-submitted live price, payment, order, production deployment or Git push occurred.


### Independent exchange direction editors — 1 November 2026

The admin now sees two fixed-direction price editors together, with full source-unit labels, explicit customer receive sentences, independent Saved/Not set status and direction-specific save buttons. Currency selectors were removed to reduce direction mistakes. Saving one editor cannot infer or populate the opposite price. Drafts and mutation attempts remain isolated per pair; existing JWT/ADMIN, DTO, idempotency, financial audit and Decimal server quote controls remain unchanged. No new monetary arithmetic, API, schema or financial mutation was introduced.

The owner saved a live price while the agent was investigating; the agent has not submitted, inverted or replaced it. Its intended units and the opposite price are awaiting owner clarification, so neither sample rates nor an inferred reciprocal were activated.

The direction-clarity regression failed before the UI change and passed afterward on separate desktop and Mobile Chrome runs (one test each, both exit 0). It verifies isolated pair payloads, zero additional markup, idempotency headers and that the opposite input stays unset after the first save. Web TypeScript and scoped ESLint passed. Actual phone/desktop admin inspection confirmed the source units, saved first direction and unset second direction; the viewport override was reset. No payment, order, production deployment or Git push was submitted.


### Confirmed independent prices and comparison — 1 November 2026

The owner clarified both direction units and an approximate reverse price. After the owner restored their admin session, the reverse rate was saved through the existing signed-in editor and protected idempotent endpoint, with its transactional FX override audit confirmed read-only. The already-saved forward price was preserved. Existing four-decimal storage and six-decimal/manual receive round-down policy were retained and their approximation was explained before submission. No direct database mutation, guard bypass, permission change, live order or fund transfer occurred.

The reverse editor now calculates a display-only minimum send amount covering one naira. Parsing and rounding use bounded BigInt rational arithmetic, with source minor units rounded upward to agree with the server's receive round-down rule. It does not modify either price, determine a payable quote or replace the server's eligibility, PIN, idempotency, settlement or audit controls.

The initial cold-route test failed before reaching the comparison; the test now waits explicitly for the editor. A subsequent replay against the previous component failed on the missing comparison. Final separate desktop and Mobile Chrome runs each passed with exit 0, as did web TypeScript, scoped ESLint and whitespace checks. Read-only production-service calculations and actual customer previews verified the saved rates in both directions. Customer swapping loaded the separate opposite price and the missing-rate message cleared. No production code deployment or Git push occurred.


### Compact admin converter presentation — 1 November 2026

At the owner's request, both independent rate editors now use the customer converter visual pattern: fixed one-unit Customer sends field, editable Customer gets field, currency badges, clear direction and a short Save rate button. Repeated explanatory paragraphs were removed. The source-unit contract, exact display comparison helper, price values, per-pair drafts/query keys, zero extra markup and idempotent API mutation remain intact. Buttons keep direction-specific accessible names, and editable amount panels have visible keyboard focus. No backend, authorization, money arithmetic or rate-storage policy changed.

Existing browser regressions passed separately on desktop and Mobile Chrome (one case each, both exit 0), verifying isolated direction saves, exact pair payloads, idempotency and comparison boundaries. Web TypeScript, scoped ESLint and whitespace checks passed. Actual signed-in phone-size inspection confirmed both simplified forms and the existing Saved prices. No live Save, price change, payment, order, production deployment or Git push was submitted in this presentation phase.

### Pending KYC explanation and VTU country headers — 2 November 2026

Read-only account/provider diagnostics and the normal authenticated BVN reconciliation action confirmed the existing validation is pending: Paystack reports unidentified, provider event history is complete without a matching terminal result, and no identification callback exists in the customer's local inbox. The accepted request was not resubmitted or promoted to verified. NIN remains in the audited manual-review queue, with its nonempty PDF confirmed in a private bucket. No real reviewer decision, permission change, account opening or financial transaction was performed. Diagnostic output and the report omit identity numbers, bank numbers, document paths, signed URLs and credentials.

Home now distinguishes submitted checks from checks not started. Account setup guidance opens verification status while identity is pending. Shared flag dropdowns replace inline country rows in the Airtime, Data, Electricity and Cable TV headers; specialist international airtime uses actual provider destinations. Unavailable markets remain disabled, country changes invalidate old operator/plan/quote state, and reselecting the current country preserves the draft. Country controls are disabled during submission and unresolved orders. Existing server validation, KYC/tier gates, PIN approval, idempotency, audited decisions, webhook signature checks and transactional balance logic remain unchanged.

Home and same-country draft regressions were observed failing before their fixes. The final focused Flutter run passed 103 tests; full Flutter analysis reports no issues. The existing backend unit suite passed 686 tests across 94 suites. Nine isolated PostgreSQL KYC HTTP scenarios passed, covering signed callbacks/replays, concurrent recovery, private evidence, authorization, idempotent manual decisions, races and tier promotion. The first E2E database choice lacked Paystack tables; verification used the current disposable database afterward without changing production schema. Native customer inspection verified pending copy, the Airtime header and international destination selection. Whitespace checks passed. No production deployment or Git push occurred. Remaining live BVN and NIN decisions are documented in `DOCS/KYC-VTU-CHECK-2026-11-02.md`.


### Exchange amounts and destination simplification — 2 November 2026

The owner requested amount-in-words labels, automatic rate checks in the exchange boxes and a simpler receiving form. Both amount helpers now use the existing exact NGN/GHS word renderer; number grouping uses string operations. Exact BigInt preview arithmetic and directional rounding remain unchanged. A read-only rate lookup runs on entry/direction changes, with debounced background refresh after editing when the rate is missing, stale or older than 30 seconds. No request is sent for each keystroke and no idle polling was added. Refresh preserves the last edited receive draft, generation checks reject outdated responses, and timers are canceled on disposal. Missing-rate/error guidance stays inside the receive box. Estimates do not authorize a financial action; the existing server quote, KYC/PIN checks, protected idempotent order creation and settlement policy remain authoritative.

Receiving details now share a single card with adaptive method choices, shorter persistent field labels and clear payment-confirmation copy. Existing validators, required destinations, disabled/pending recovery states and direction-specific settlement capabilities remain intact. No backend, schema, rate value, balance operation or account permission changed.

Converter regressions were observed failing before implementation. The focused exchange/amount-word suite passed 46 tests. Three separate visual fixtures passed at phone, desktop and 320-pixel dark/large-text sizes, including bank-method switching; actual signed-in inspection confirmed the revised exchange text. A test falsely interpreted a random UUID containing the synthetic PIN digits as a PIN leak; its assertion now checks the exact persisted keys and fingerprint payload instead. No real exchange order, PIN, payment, production deployment or Git push was submitted. Phase evidence is in `.superpowers/sdd/2026-11-02-exchange-simplify/`.


### Final money-flow audit — 2 November 2026

The owner requested an end-to-end money-flow audit. This phase reviewed the current checkout and ran isolated tests; it did not modify application code, move funds, create provider payments, approve identities, change permissions or deploy/push. Read-only connected-database diagnostics recorded only aggregate counts and nonsecret feature/rate-source metadata. No PINs, account numbers, credentials or document URLs were extracted.

Fresh verification passed: 686 backend unit tests, 65 isolated PostgreSQL/Redis financial tests, 426 Flutter tests, backend production-scope TypeScript and web TypeScript. The first financial run lacked the explicit dedicated Redis URL; rerunning with an isolated local Redis instance passed. An initial full Flutter attempt hit a no-space compiler error; its fresh full rerun passed. The isolated test Redis was stopped afterward. Existing shared source edits were preserved.

The audit documented two high-priority and five medium-priority findings in `DOCS/MONEY-FLOW-AUDIT-2026-11-02.md`: post-commit idempotency loss affecting withdrawal/VTU replay; ignored Paystack refund/dispute events; a fast request-hash PIN oracle under digest disclosure; VTU terminal-state regression from late initial responses; missing manual payout handover; exhausted VTU recovery without explicit escalation; and a one-minor-unit reconciliation blind spot. Offline probes use synthetic data and fake financial dependencies. These are remaining findings, not claimed fixes. Passing existing tests does not override their evidence or prove live settlement readiness.

### Money-flow audit remediation — 2 November 2026

F1–F7 are addressed in [the remediation report](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/DOCS/MONEY-FLOW-FIXES-2026-11-02.md). Withdrawal and VTU reservation use stable user/operation/client-key references under the unique database index and the same balance transaction. A replay reads only the authenticated user's original operation before new-work PIN/config gates; new money movement still requires its existing PIN, tier, limits, holds and balance checks. Post-commit response/cache failures retain durable replay. Both idempotency header names are accepted at the HTTP boundary.

Sensitive auth fingerprints use a domain-separated HMAC; financial business fingerprints exclude transaction PINs. Migration 048 retires legacy unkeyed digests while retaining replay rows, and a dry-run-default, explicit-Redis maintenance CLI retires only the old cache namespace. No secret or cache key is logged. Signed handover upload credentials use durable proof intents, never generic plaintext replay caching.

Verified Paystack refund/dispute cases persist independent ownership, amount, currency, environment and economic-event correlation, global outbound holds and audits. Only an explicit admin decision can recover a verified processed refund; original funding must still be SUCCESS, duplicate/aggregate recovery is capped, and a serializable nonnegative ledger transaction records a dedicated FUNDING_RECOVERY debit. Existing reconciliation holds remain enforced during recovery. Provider recheck uses stored event evidence, cannot move money, and cannot reopen a resolved case. New table RLS/revoked Data API privileges and amount constraints protect the record. Checkout channels default to explicitly configured bank transfer and are frozen per attempt.

VTU transient updates serialize with terminal finalization and preserve receipts. Exhaustion has a persisted marker, unique admin alert/audit and a fair bounded recovery queue; no threshold refund/resend occurs. Contradictory legacy success is held for review until provider success confirms repair. Manual external payout handover requires active admin, reason, private outcome evidence and optimistic version checks; UNKNOWN cannot be reassigned and already-sent exact proof cannot authorize another payout. Reconciliation flags every exact nonzero Decimal difference.

Final verification: 745 backend tests/100 suites; 81 isolated PostgreSQL/Redis financial tests/12 suites; 426 Flutter tests; 32 relevant desktop/mobile browser cases; Flutter analysis; production web build; backend/web type checks; affected backend lint and complete website source/e2e/config lint; and diff whitespace checks passed. Independent follow-up review found no remaining P1/P2 blocker in the reviewed scope. Migrations 047–051 and Redis retirement were exercised only in disposable test infrastructure. No real customer/provider financial action, identity decision, production migration, deployment, commit or push was performed; live merchant/callback/liquidity/settlement acceptance remains required.


### BVN-first tier policy — 2 November 2026

Owner-approved policy: BVN activates Tier 1; BVN plus verified NIN activates Tier 2. Supported outbound actions use Tier 1 eligibility but retain their tighter existing action caps, PIN authorization, settlement holds and feature/provider checks. New Tier 1 NGN per-transaction, aggregate daily and maximum-balance settings must be explicitly approved/configured; missing or invalid values fail closed. Wallet row locks serialize limits and movements in the same transaction, including cross-product spending and external exchange reservations. Compensating refunds/reversals do not get stranded by customer limits. Provider-confirmed over-limit inflows remain in the existing uncredited receipt/reconciliation process.

Ninja NIN is a separate readiness-gated match-only adapter. It requires verified BVN for new automated upgrades, complete strict field matches and explicit consent, and never stores raw registry/provider identity payloads. Automated provider outcomes cannot be manually approved. Existing manual evidence decisions, provider obligations and earned tiers retain their original audit history; no synthetic provider decisions or live activation are authorized by local test results. Customer web remains retired in production; local QA rendering requires the existing non-production random test token.

### Approved Ninja NIN restoration — 2 November 2026

The owner confirmed approval and authorized restoring Ninja as the NIN provider. The existing live credential passed a read-only account authentication check (HTTP 200); no registry lookup or customer identity decision was submitted. Local configuration enables the strict NIN adapter and migrates the existing server secret to its canonical name, retaining Paystack BVN. The Render blueprint declares the live URL, enable flag and secret-only key slot; no remote environment mutation, restart, deployment or credential logging occurred. All 57 focused KYC/provider/configuration tests and local adapter readiness checks passed. See `DOCS/NINJA-NIN-RESTORED-2026-11-02.md`.

### Eligibility reliability refactor — 2 November 2026

Web and Flutter eligibility/presentation now share strict parsers for supported tiers rather than extracting arbitrary digits. The web query hook delegates status precedence and exact amount checks to a pure function; explicit invalid Tier 1 policy produces availability/support guidance. Backend debit and external exchange checks share the same eligibility assertion, and external Tier 1 exchange validates the user state returned with the wallet lock. Pending BVN confirmation cannot enable NIN or claim active Tier 1 through a supplied callback. Existing JWT/role guards, DTOs, idempotency, Decimal amounts, holds, financial transactions and audit history remain authoritative. No new endpoint/schema, production setting, provider action or deployment was introduced. Verification and regression evidence are recorded in `DOCS/implementation/2026-11-02-eligibility-refactor.md`.

### BVN retry and profile conflict correction — 2 November 2026

The precise duplicate-phone constraint now returns a structured conflict instead of a generic internal error; successful profile edits retain their transaction and audit, and identity locks remain enforced. Flutter handles nested errors without falsely locking a correctable phone conflict, preserves uncertain-attempt keys and reads saved details before retrying. No real profile unlock, KYC submission, account creation or identity approval was performed. Customer-facing account branding and form layout were improved while preserving explicit provider consent. Tests and limits are recorded in `DOCS/implementation/2026-11-02-bvn-retry-ux.md`.


### Durable manual exchange notifications — 2 November 2026

Manual payment-proof submission now creates a durable ADMIN inbox event in the same Prisma transaction as the submission. Confirmed deposits and completed wallet/external payouts create order-owner USER events in the same financial/state transaction. Unique event keys and duplicate-skipping inserts preserve one event per proof/milestone across concurrent approvals, lost-response retries and repeated requests; corrected evidence after a request for more information creates a distinct review event. Wallet credit produces one combined confirmation/completion message. No alert claims that proof submission alone confirms receipt of funds.

JWT-scoped customer APIs and JWT/ADMIN-guarded admin APIs isolate audiences and read receipts, validate UUIDs/idempotency headers and throttle requests. Per-actor read upserts preserve their original read timestamp. Migration 052 enables RLS and revokes direct PUBLIC/anon/authenticated table access; it was applied only to the disposable financial test database and remains required before release. Existing protected financial actions, PIN checks, Decimal arithmetic, deposit allocation, audit records and manual payout policy remain authoritative. No real payment, approval, payout, production migration or external message was sent.

Verification passed 767 backend unit tests, 89 isolated PostgreSQL/Redis financial tests, 29 targeted Flutter tests, Flutter analysis, backend/web TypeScript, affected lint and diff whitespace checks. Financial tests include duplicate/concurrent proof/approval, cross-audience access, older unread work, unprivileged RLS, and rollback of wallet credit/deposit allocation when notification persistence fails. A fresh full Flutter run completed with 450 passing tests and three unrelated BVN-first KYC visual-fixture failures; no all-suite success is claimed. Browser coverage and release details are recorded in DOCS/implementation/2026-11-02-exchange-notifications.md. The implemented channel is in-app polling with durable read state, not email/SMS/operating-system push.

### 2026-11-02 receiving-account setup intent

NGN receiving-account setup may now be requested before KYC completion. This records an authenticated, validated, rate-limited and idempotent consent intent in `WAITING_FOR_KYC`; it never creates or reveals a usable account at that stage. The user row lock serializes intent creation, and consent plus audit are written atomically. Existing requests are reused without resetting provider processing. The worker selects only active verified Tier 1/2 owners with verified Paystack BVN, and actual provisioning retains the existing KYC and provider checks, lease and recovery behavior. No tier, transaction limit, identity decision or account-number disclosure rule was relaxed. Wallet balance visibility now depends on the user's eye-toggle preference rather than account issuance. Validation uses synthetic data and does not perform live financial actions.


### 2026-11-02 Ghana exchange receiving details

The exchange form now separates receiving-method selection from recipient details. The Ghana bank picker uses named institutions and local logo assets, never inferred bank codes. Account-number-based bank detection and bank-name lookup remain unavailable rather than being simulated. Provider-backed MoMo lookup validates returned number/operator and rejects stale responses after edits, method changes, submission or disposal. Failed/unavailable lookups retain the existing explicit manual-review flow. Transaction PIN, idempotency, manual settlement, tier limits and server-side money checks are unchanged. Validation uses synthetic recipients and does not execute live financial or identity actions.


### 2026-11-02 FX rate direction and support

Admin rate reads and writes now reject reversed NGN/GHS rate units under the current Ghana-pair direction policy. The canonical rate remains target units per source unit, with existing persisted precision and frozen historical quotes. Flutter hides invalid estimates rather than inverting only the screen; admin input displays the unit and blocks reversed values. Hosted rates were read only, and owner-approved business prices remain required before correction through the existing authenticated, idempotent, audited endpoint. Page-menu WhatsApp links contain only a generic greeting and the public support number; no customer details or automatic sending are included. Validation and limits are recorded in DOCS/implementation/2026-11-02-fx-direction-support.md.
