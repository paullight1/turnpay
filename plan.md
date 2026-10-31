# TRUSTPAY Production Readiness Implementation Plan

> Provider note (2026-09-01): provider references in this historical plan are superseded by `DOCS/PROVIDER-SOURCE-OF-TRUTH.MD`. This historical plan is superseded. Active providers are Monnify for banking/payments/KYC and VTpass for VTU.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for isolated workstreams and review each task before integration. Steps use checkbox syntax for tracking.

**Goal:** Move TRUSTPAY from active development to a production-ready fintech platform by closing financial-integrity, security, reliability, operational, mobile, infrastructure, and release-verification gaps.

**Architecture:** Preserve the current NestJS + Prisma + PostgreSQL + Redis backend, Next.js web/admin client, and Flutter mobile client. Harden trust boundaries first: authenticated mutations, provider webhooks, wallet/ledger writes, and release artifacts. Provider-dashboard activation and production secret provisioning remain operator gates, while all repository code, tests, configuration templates, and runbooks are implemented here.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Redis, Pino, class-validator, Next.js 16, Supabase, Flutter, Riverpod, Dio, Docker, GitHub Actions.

## Current checkpoint — 2026-08-15

Implemented in the current branch: retry-safe webhook inbox and async processing, strict webhook/auth DTOs, atomic OTP/PIN throttling, HttpOnly web sessions with CSRF coverage, mobile cleartext and release-signing gates, hardened containers/deployment manifests, CI safety checks, fail-closed production database credentials, zero-audit-vulnerability lockfiles, a clean backend lint gate, and persisted reconciliation runs that block on mismatches.

Still launch-blocking: provider credential/KYB/webhook certification, production migration/backups/restore evidence, mobile Flutter verification plus certificate pinning/device-integrity adapters, and broader admin dual-control coverage for all high-value manual actions. These remain explicitly tracked below; no live provider or production infrastructure action was performed.

## Global Constraints

- Every mutation endpoint accepts an `Idempotency-Key`; financial and webhook retries return the original result.
- Every balance mutation uses one Prisma transaction with Decimal-safe arithmetic and no negative balances.
- Every request and webhook payload is validated by a DTO with whitelist/forbid validation enabled.
- Every protected route uses `JwtAuthGuard`; admin mutations require role enforcement and audit records.
- Access tokens expire in 15 minutes or less; refresh tokens expire in 7 days or less and rotate single-use.
- OTP expires within 5 minutes, permits at most 3 verification attempts, and is rate-limited per phone or email identity.
- No secrets, tokens, PINs, passwords, provider payload credentials, or full account numbers are logged or committed.
- Provider webhooks verify signatures before trust-sensitive parsing, acknowledge within 5 seconds, process asynchronously, retry, and dead-letter after exhaustion.
- Monetary values use Prisma `Decimal`; fee calculation is server-side; historical amounts are never recalculated from current rates.
- Production web sessions use HttpOnly, Secure cookies; mobile production traffic uses HTTPS, cleartext disabled, pinning, and release signing.
- No known production dependency CVEs remain; production services have health checks, backups, monitoring, and environment isolation.
- Tests must cover duplicate requests, duplicate provider events, out-of-order events, concurrent requests, insufficient balance, currency mismatch, rounding, and reversal/refund behavior.

## Execution Strategy

Work in isolated agent worktrees from the current checkout. The existing uncommitted changes are user-owned and must be preserved. Run the following groups in parallel only when their file scopes do not overlap:

- **Group A — Backend trust boundaries:** webhook inbox/retry, DTO validation, OTP concurrency, provider configuration, idempotency cleanup.
- **Group B — Web security:** HttpOnly session migration, CSRF, inactivity logout, CSP, e2e security coverage.
- **Group C — Mobile security/release:** PIN protection, cleartext policy, pinning, device-integrity checks, release signing, Flutter tests.
- **Group D — Infrastructure and CI:** production deployment manifests, container hardening, backups/health checks, dependency and CI gates.
- **Sequential integration:** reconciliation controls, admin dual approval, migration verification, provider certification, final whole-repository review.

Each agent must change only its assigned files, add focused tests, run the listed commands, and report any external operator gate rather than fabricating credentials or provider results.

---

## Phase 0: Baseline and Worktree Safety

### Task 0.1: Establish the implementation ledger and baseline

**Files:**
- Create: `.superpowers/sdd/trustpay-production-readiness/progress.md`
- Modify: `plan.md`

**Steps:**

- [ ] Record the current commit, branch, dirty-file list, Node versions, package-manager versions, and available Flutter/Dart toolchain.
- [ ] Record the baseline results of `npm test -- --runInBand`, `npm run test:e2e -- --runInBand`, `npm run build`, `npm run lint -- --quiet`, `npx tsc --noEmit --pretty false`, `npm audit --omit=dev`, and `npx prisma migrate status`.
- [ ] Add one ledger entry per implementation task before dispatching agents; do not use `git reset`, `git checkout`, or broad cleanup commands.
- [ ] Confirm generated artifacts and ignored environment files are excluded from every commit.

**Verification:**

```bash
git status --short
git rev-parse HEAD
node --version
npm --version
```

### Task 0.2: Repair backend quality gates before feature integration

**Files:**
- Modify: `BACKEND/src/admin/admin.service.spec.ts`
- Modify: `BACKEND/src/auth/auth.controller.spec.ts`
- Modify: `BACKEND/src/kyc/kyc.service.spec.ts`
- Modify: `BACKEND/test/banking-provisioning.e2e-spec.ts`
- Modify: backend files reported by ESLint/Prettier

**Steps:**

- [ ] Fix the missing `providerEvent` test mock used by `AdminService.getTransactionDrilldown` without weakening production behavior.
- [ ] Align test DTO fixtures and typed mock configuration with current DTO and service signatures.
- [ ] Run Prettier/ESLint only on changed source and test files, then run the complete backend lint command.
- [ ] Keep assertions for error type, status transition, and sanitized output; do not delete failing tests to obtain a green run.

**Verification:**

```bash
cd BACKEND
npm test -- --runInBand
npm run test:e2e -- --runInBand
npx tsc --noEmit --pretty false
npm run lint -- --quiet
npm run build
```

---

## Phase 1: Backend Financial and Trust-Boundary Hardening

### Task 1.1: Build a retry-safe webhook inbox

**Files:**
- Modify: `BACKEND/prisma/schema.prisma`
- Create: `BACKEND/prisma/migrations/<timestamp>_webhook_inbox_claims/migration.sql`
- Create: `BACKEND/src/payments/webhooks/webhook-inbox.service.ts`
- Create: `BACKEND/src/payments/webhooks/webhook-inbox.service.spec.ts`
- Modify: `BACKEND/src/payments/webhooks/payment-webhook.controller.ts`
- Modify: `BACKEND/src/payments/payment.service.ts`
- Modify: `BACKEND/src/payments/payments.module.ts`

**Interfaces:**

- `WebhookInboxService.accept(input): Promise<{ eventId: string; duplicate: boolean }>` atomically inserts or returns an existing provider/event reference.
- `WebhookInboxService.claim(eventId): Promise<boolean>` atomically claims only `RECEIVED` or retryable events.
- `WebhookInboxService.complete(eventId, result)` and `WebhookInboxService.fail(eventId, error)` persist terminal/retry metadata.
- `WebhookInboxService.recoverStaleClaims(maxAgeSeconds)` returns stale `PROCESSING` events to `RECEIVED`.

**Steps:**

- [ ] Add provider, event type, provider reference, payload hash, sanitized payload, status, attempt count, next-attempt time, last error, received/processed timestamps, and a unique provider/reference key to the schema.
- [ ] Move payment webhook handlers to signature verification → DTO validation → inbox accept → immediate `{ received: true }` response.
- [ ] Process accepted events from a scheduled worker with bounded retries and exponential backoff; preserve provider amount/currency verification inside the business transaction.
- [ ] Make duplicate, out-of-order, failed, and reversed events deterministic; never acknowledge a stuck event as successfully processed.
- [ ] Add a dead-letter query and admin-visible failure count without exposing raw secrets.

**Verification:**

- Duplicate webhook delivery creates one inbox event and one ledger movement.
- Crash after claiming leaves the event recoverable.
- Failed processing retries and eventually dead-letters.
- Out-of-order pending/success/reversal events follow valid transaction transitions.

### Task 1.2: Add DTO validation to every payment and provider webhook

**Files:**
- Create or modify: `BACKEND/src/payments/webhooks/dto/*.dto.ts`
- Modify: `BACKEND/src/payments/webhooks/payment-webhook.controller.ts`
- Modify: `BACKEND/src/banking/dto/banking.dto.ts`
- Modify: `BACKEND/src/vtu/dto/vtu.dto.ts`
- Modify: webhook controller specs under `BACKEND/src/**`

**Steps:**

- [ ] Replace controller interfaces used as request bodies with class-validator DTOs.
- [ ] Validate event type, provider reference length, status enum, amount bounds, currency whitelist, account/reference formats, and bounded payload size.
- [ ] Keep raw-body signature verification before business processing and never trust amount/currency without matching the internal transaction.
- [ ] Add rejection tests for missing fields, oversized values, unsupported currencies, malformed references, and invalid signatures.

### Task 1.3: Make OTP and transaction-PIN controls race-safe

**Files:**
- Modify: `BACKEND/src/otp/otp.service.ts`
- Modify: `BACKEND/src/auth/auth.controller.ts`
- Modify: `BACKEND/src/auth/dto/auth.dto.ts`
- Modify: `BACKEND/src/common/services/transaction-pin.service.ts`
- Create or modify: focused OTP/PIN specs

**Steps:**

- [ ] Replace Redis read/modify/write attempt counters with atomic `INCR` plus expiry-preserving logic or a Lua script.
- [ ] Enforce OTP send limits by normalized phone hash and password-reset limits by normalized email hash, not only by generic request identity.
- [ ] Enforce strict E.164 phone validation and bounded six-digit OTP validation in DTOs.
- [ ] Make PIN failure counters and daily limits atomic; preserve lockout behavior under concurrent invalid attempts.
- [ ] Add concurrent tests proving the maximum attempt count cannot be bypassed.

### Task 1.4: Make provider configuration fail closed

**Files:**
- Modify: `BACKEND/src/app.module.ts`
- Modify: `BACKEND/.env.example`
- Modify: `render.yaml`
- Modify: `BACKEND/src/health/health.controller.ts`
- Create: `BACKEND/src/health/provider-readiness.service.ts` and focused tests

**Steps:**

- [ ] Require Monnify credentials, live base URL, webhook secret, and exchange collection account when banking, virtual accounts, or withdrawals are enabled.
- [ ] Require VTpass credentials and a non-sandbox URL when VTU is enabled in production.
- [ ] Reject known sandbox URLs when `NODE_ENV=production`.
- [ ] Add provider readiness checks that report configuration presence and endpoint mode without returning secrets.
- [ ] Ensure `/api/health` is unhealthy when required production providers are not configured.

### Task 1.5: Add idempotency and financial-record retention jobs

**Files:**
- Create: `BACKEND/src/common/services/retention.service.ts`
- Modify: `BACKEND/src/common/services/reconciliation.module.ts`
- Modify: `BACKEND/src/common/interceptors/idempotency.interceptor.ts`
- Create: focused retention/idempotency specs

**Steps:**

- [ ] Add a scheduled cleanup for expired idempotency records, completed webhook inbox rows beyond the retention window, and non-financial operational logs.
- [ ] Never delete transaction, ledger, audit, or provider evidence required for reconciliation; archive or mark retained records instead.
- [ ] Make cleanup batched and observable with counts, duration, and failure logs.
- [ ] Add a database index and bounded batch size for each cleanup query.

### Task 1.6: Implement durable reconciliation and transaction-state controls

**Files:**
- Modify: `BACKEND/src/common/services/reconciliation.service.ts`
- Modify: `BACKEND/src/common/services/reconciliation.module.ts`
- Modify: `BACKEND/prisma/schema.prisma`
- Create: reconciliation migration and specs
- Modify: `BACKEND/src/payments/payment.service.ts`
- Modify: `BACKEND/src/transfers/transfers.service.ts`

**Steps:**

- [ ] Persist every reconciliation run with status, scope, counts, mismatch details, and completion timestamps.
- [ ] Check wallet-versus-ledger balances, orphaned transactions, missing provider references, double-entry completeness, invalid status transitions, and negative balances.
- [ ] Emit an operator alert and block automatic settlement when a critical mismatch is found.
- [ ] Define and enforce valid pending/success/failed/reversed/refunded transitions for deposits, transfers, withdrawals, and refunds.
- [ ] Add concurrent debit, reversal, currency mismatch, and rounding tests.

### Task 1.7: Add high-value admin dual control

**Files:**
- Modify: `BACKEND/prisma/schema.prisma`
- Create: migration for approval requests
- Create: `BACKEND/src/admin/approval.service.ts`
- Create: `BACKEND/src/admin/approval.service.spec.ts`
- Modify: `BACKEND/src/admin/admin.controller.ts`
- Modify: `BACKEND/src/admin/admin.service.ts`
- Modify: admin DTOs and website admin operations

**Steps:**

- [ ] Create append-only approval requests with action, target transaction, amount, currency, initiator, approver, reason, expiry, and audit references.
- [ ] Require a distinct admin identity for approval and reject self-approval.
- [ ] Make approval and execution idempotent and transactionally linked to the financial action.
- [ ] Apply the threshold to exchange credits, manual wallet credits, withdrawals, rate changes, and reversals.
- [ ] Add tests for self-approval, duplicate approval, expired approval, concurrent approval, and unauthorized roles.

---

## Phase 2: Web and Admin Security

### Task 2.1: Migrate web auth to HttpOnly-only sessions

**Files:**
- Modify: `WEBSITE/src/lib/supabase-session.ts`
- Modify: `WEBSITE/src/app/api/auth/session/route.ts`
- Modify: `WEBSITE/src/proxy.ts`
- Modify: `WEBSITE/src/services/api.ts`
- Modify: website auth tests and e2e specs

**Steps:**

- [ ] Remove access-token persistence from `localStorage` and JS-readable cookies.
- [ ] Add a server-side session/refresh endpoint that reads the HttpOnly cookie and returns only the minimum user/session state required by the client.
- [ ] Update API requests to use same-origin server proxy or short-lived in-memory authorization only where unavoidable.
- [ ] Rotate and revoke sessions on logout, password change, PIN reset, and inactivity timeout.
- [ ] Add tests proving XSS-readable storage contains no access or refresh token.

### Task 2.2: Add CSRF, inactivity timeout, and hardened CSP

**Files:**
- Create: `WEBSITE/src/lib/csrf.ts`
- Create: `WEBSITE/src/app/api/csrf/route.ts`
- Modify: `WEBSITE/src/proxy.ts`
- Modify: `WEBSITE/next.config.ts`
- Modify: dashboard auth provider/components
- Modify: website e2e specs

**Steps:**

- [ ] Issue a CSRF token bound to the HttpOnly session and require it on every state-changing same-origin request.
- [ ] Enforce 15-minute inactivity logout with a warning and server-side session revocation.
- [ ] Replace `unsafe-inline` CSP usage with nonce/hash-based script policy compatible with Next.js production output.
- [ ] Add e2e coverage for blocked cross-site mutation, expired inactivity session, and successful same-origin mutation.

### Task 2.3: Complete admin operational surfaces

**Files:**
- Modify: `WEBSITE/src/app/admin/**`
- Modify: `WEBSITE/src/services/**`
- Modify: backend admin DTOs/controllers as required
- Modify: website Playwright specs

**Steps:**

- [ ] Add pending webhook/DLQ, pending withdrawal, transfer attempt, provider event, ledger, audit, user wallet/KYC, and approval-request views with masked sensitive fields.
- [ ] Add explicit operator actions with confirmation, reason codes, role checks, idempotency keys, and audit display.
- [ ] Add empty, loading, error, pagination, and stale-data states.
- [ ] Add smoke tests for each high-risk admin action.

---

## Phase 3: Mobile Security and Release Readiness

### Task 3.1: Remove raw transaction-PIN persistence

**Files:**
- Modify: `APP/lib/services/transaction_security_service.dart`
- Modify: `APP/lib/services/api_client.dart`
- Modify: mobile security tests

**Steps:**

- [ ] Replace stored plaintext PIN with an OS-protected, biometric-gated cryptographic key or device-bound approval flow.
- [ ] Ensure biometric approval never returns a reusable PIN to application memory longer than the single request.
- [ ] Clear keys on biometric enrollment change, logout, account switch, and device compromise signal.
- [ ] Add tests for biometric denial, key invalidation, logout cleanup, and transaction retry idempotency.

### Task 3.2: Add mobile transport and device-integrity controls

**Files:**
- Modify: `APP/android/app/src/main/AndroidManifest.xml`
- Modify: `APP/ios/Runner/Info.plist`
- Modify: `APP/lib/services/api_client.dart`
- Create: platform security service and tests

**Steps:**

- [ ] Set `android:usesCleartextTraffic="false"` for release-capable manifests.
- [ ] Implement production certificate/public-key pinning with a documented rotation process and a debug-only bypass.
- [ ] Add root/jailbreak/emulator risk detection and require step-up verification or block sensitive money actions when risk is high.
- [ ] Keep production logging redacted and disabled for tokens, PINs, account numbers, and provider responses.

### Task 3.3: Fail closed on unsigned Android release builds and complete mobile observability

**Files:**
- Modify: `APP/android/app/build.gradle.kts`
- Modify: `APP/android/key.properties.example`
- Modify: `APP/lib/main.dart`
- Modify: mobile CI workflow

**Steps:**

- [ ] Make `release` throw a Gradle configuration error when production signing properties are absent; retain debug signing only for debug/profile variants.
- [ ] Add release build metadata and environment validation for the production API URL and Sentry DSN.
- [ ] Add `flutter analyze`, unit/widget tests, and signed Android/iOS build checks to CI.
- [ ] Document keystore storage, rotation, and CI secret injection without committing secrets.

---

## Phase 4: Infrastructure, Dependencies, and CI/CD

### Task 4.1: Harden production deployment manifests

**Files:**
- Modify: `render.yaml`
- Modify: `docker-compose.prod.yml`
- Modify: `BACKEND/Dockerfile`
- Modify: `WEBSITE/Dockerfile`
- Modify: `BACKEND/fly.toml` or establish one canonical deployment target

**Steps:**

- [ ] Replace sandbox URLs and wrong webhook origins with environment-provided live values; reject unsafe values in production startup.
- [ ] Use paid PostgreSQL/Redis plans with TLS, backups, retention, and high-availability settings appropriate to transaction volume.
- [ ] Run containers as non-root users, add backend/website health checks, use read-only filesystems where practical, and pin base image versions.
- [ ] Ensure only the reverse proxy is publicly exposed; enforce HTTPS, HSTS, WAF rules, and restricted database/Redis networking.
- [ ] Add rollback and migration-forward procedures to `DOCS/PRODUCTION-GUIDES/20-MIGRATION-RUNBOOK.md`.

### Task 4.2: Remove known dependency vulnerabilities

**Files:**
- Modify: `BACKEND/package.json`, `BACKEND/package-lock.json`
- Modify: `WEBSITE/package.json`, `WEBSITE/package-lock.json`
- Modify: root lockfiles only when required by the dependency graph

**Steps:**

- [ ] Upgrade vulnerable direct dependencies, prioritizing Next.js, Axios, and every runtime package reported high by `npm audit`.
- [ ] Re-run audit with production-only and complete dependency scopes; document any unavoidable transitive exception with owner and expiry.
- [ ] Add CI failure gates for critical/high runtime vulnerabilities.
- [ ] Run backend and website builds, tests, and Playwright smoke tests after upgrades.

### Task 4.3: Strengthen CI release gates

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/security.yml`
- Create: scripts for migration drift, secret scanning, and release configuration validation

**Steps:**

- [ ] Require backend tests, E2E, typecheck, lint, build, Prisma validation, migration drift check, and audit before merge.
- [ ] Require website lint/build/Playwright smoke tests.
- [ ] Require Flutter analyze/test/release build when Flutter tooling is available in CI.
- [ ] Add secret scanning, dependency audit, container scan, SBOM generation, and artifact provenance.
- [ ] Prevent production deployment when provider readiness, signing, migration, or backup checks fail.

### Task 4.4: Add backups, monitoring, and incident runbooks

**Files:**
- Modify: `DOCS/PRODUCTION-GUIDES/18-BACKEND-DEPLOYMENT.md`
- Modify: `DOCS/PRODUCTION-GUIDES/19-WEB-DEPLOYMENT.md`
- Modify: `DOCS/PRODUCTION-GUIDES/10-RECONCILIATION.MD`
- Create: `DOCS/PRODUCTION-GUIDES/21-INCIDENT-RESPONSE.md`
- Modify: Sentry/health/alert configuration files

**Steps:**

- [ ] Define daily database backups with 30-day retention, restore drills, Redis recovery expectations, and evidence locations.
- [ ] Configure backend, web, queue, database, Redis, webhook DLQ, reconciliation, latency, and provider-failure alerts.
- [ ] Document incidents for duplicate payment, stuck webhook, ledger mismatch, provider outage, secret compromise, and rollback.
- [ ] Define 90-day audit/log retention and access controls.

---

## Phase 5: Staging Certification and Go-Live

### Task 5.1: Validate migrations and staging environment

**Files:**
- Modify: `DOCS/PRODUCTION-GUIDES/20-MIGRATION-RUNBOOK.md`
- Modify: environment templates and deployment configuration

**Steps:**

- [ ] Apply all migrations to a disposable staging database using `npx prisma migrate deploy`.
- [ ] Verify rollback/recovery procedure without destructive production commands.
- [ ] Confirm separate staging database, Redis, Supabase project/buckets, provider credentials, webhook URLs, and Sentry project.
- [ ] Capture migration status and health-check evidence.

### Task 5.2: Execute provider and financial certification

**Files:**
- Modify: provider integration tests and certification runbooks
- Modify: `DOCS/REALTIME-BANKING/PHASE-01/06-GO-NOGO-DECISION-RECORD.MD`

**Steps:**

- [ ] Test Monnify virtual-account provisioning, successful deposit, duplicate deposit, delayed deposit, incorrect amount, incorrect currency, reversal, and webhook retry.
- [ ] Test transfer success, failure, pending timeout, reversal, duplicate callback, and reconciliation fallback.
- [ ] Test VTpass duplicate, timeout, failure, and reversal events.
- [ ] Test exchange quote expiry, fee rounding, admin approval, duplicate approval, and ledger reconciliation.
- [ ] Obtain provider-dashboard evidence for live KYB, credentials, webhook registration, and settlement configuration.

### Task 5.3: Final release gate

**Files:**
- Modify: `plan.md`
- Modify: `DOCS/REALTIME-BANKING/PHASE-01/06-GO-NOGO-DECISION-RECORD.MD`

**Steps:**

- [ ] Confirm zero critical/high runtime dependency vulnerabilities or documented risk acceptance by the security owner.
- [ ] Confirm all backend, web, mobile, integration, and security checks pass from a clean release candidate.
- [ ] Confirm migrations, backups, restore drill, monitoring, WAF, HTTPS, provider webhooks, secrets, signing, and rollback evidence.
- [ ] Require engineering, finance/operations, compliance, and security sign-off before enabling real-money traffic.
- [ ] Enable production traffic gradually with transaction limits, enhanced reconciliation, and active incident coverage.

## Definition of Done

- [ ] No P0/P1 security or financial-integrity findings remain open.
- [ ] All mutation and provider-event flows are idempotent, retry-safe, auditable, and covered by concurrency tests.
- [ ] Backend, website, and mobile release gates pass in CI from a clean checkout.
- [ ] Production infrastructure is HTTPS-only, monitored, backed up, isolated, and fails closed on unsafe configuration.
- [ ] Provider certification, migration evidence, restore evidence, and operational runbooks are attached to the go/no-go record.
- [ ] Real-money launch remains disabled until all required human approvals and external provider controls are complete.
