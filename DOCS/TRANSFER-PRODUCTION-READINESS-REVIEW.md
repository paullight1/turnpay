# TRUSTPAY Internal Transfer Production-Readiness Review

Date: 2026-09-01

Scope: Flutter internal-transfer UI (`/send/trustpay`), NestJS transfer API, Prisma wallet/ledger writes, idempotency, transaction PIN, rate limits, auditability, and web product parity.

Decision: **NO-GO for real-money production pending external certification.** The code-level critical/high controls and automated regression proof are implemented, but staging, Product Security, Risk/Compliance, cross-functional approval, and canary-observation gates are not complete. `INTERNAL_TRANSFERS_ENABLED` must remain `false` in production.

## Remediation status — 2026-09-01

The detailed findings below are the original review baseline. This table is the current disposition and supersedes the original “required fix” wording where implementation is complete.

| Finding   | Current disposition                         | Evidence                                                                                                                                                                                              |
| --------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TP-TR-001 | Code closed; staging proof pending          | Business idempotency is committed with the transfer. Real PostgreSQL post-commit fault/retry test proves one attempt, two transactions, two ledgers, one audit, and one reservation per limit period. |
| TP-TR-002 | Closed                                      | Migrations through `033_sensitive_idempotency_responses` deploy to a fresh disposable database. Migration/RLS baseline was committed as `ed15922`.                                                    |
| TP-TR-003 | Code closed; device matrix pending          | Server PIN status/verify is authoritative; fresh/existing device UI certification passes and the same auth/security dependencies are preserved through the PIN route.                                 |
| TP-TR-004 | Code closed; managed topology drill pending | Deployed modes disallow memory fallback. Real Redis disconnect/reconnect tests prove PIN mutation and transfer fail closed before any balance effect.                                                 |
| TP-TR-005 | Control implemented; approval pending       | Audited, four-eyes, currency/tier/version-specific Decimal policies fail closed. Written production NGN/GHS values still require Risk/Compliance approval.                                            |
| TP-TR-006 | Closed                                      | Append-only, full compensating reversal with four-eyes approval, idempotency, blocked-insufficient-funds state, and concurrency/conservation proof.                                                   |
| TP-TR-007 | Closed                                      | Request context, masked counterparty, digest, financial audit, admin search, and zero-tolerance reconciliation are implemented and tested.                                                            |
| TP-TR-008 | Closed                                      | Auth mutation policies are enumerated in tests; PIN mutations are idempotent and token-bearing replay data is AES-256-GCM encrypted.                                                                  |
| TP-TR-009 | Closed                                      | Independent semantics, 48×48 targets, large-text coverage, and keyboard focus tests pass.                                                                                                             |
| TP-TR-010 | Closed                                      | Web, Flutter, and DTO contract enforce 120 Unicode code points.                                                                                                                                       |
| TP-TR-011 | Closed                                      | Independent authenticated-user and IP limiters use Redis-backed distributed state.                                                                                                                    |
| TP-TR-012 | Closed                                      | Review and receipt show amount, fee `0.00`, and exact total debit.                                                                                                                                    |
| TP-TR-013 | Closed in CI design                         | Real PostgreSQL/Redis financial and fault suites plus Flutter and Playwright transfer certification are committed and wired into CI.                                                                  |
| TP-TR-014 | Closed                                      | Web `/dashboard/send` provides typed TrustPay transfer parity; bank payout remains `/dashboard/withdraw` and is labelled “Withdraw to bank.”                                                          |
| TP-TR-015 | Mitigated; approval pending                 | Uniform HTTP 200 unavailable response, masking, dual throttles, bounded timing, and digest-only enumeration monitoring are implemented. Product Security residual-risk acceptance remains pending.    |
| TP-TR-016 | Closed                                      | Backend/mobile/web tests prove PINs, tokens, request/response bodies, and raw retry keys are absent from captured logs.                                                                               |

Automated local evidence at this worktree state:

- Backend: lint and build pass; 52 suites / 354 unit tests pass.
- Financial E2E: 2 real-infrastructure suites / 10 tests pass against PostgreSQL 16 and Redis 8, including post-commit kill, two-instance debit contention, Redis loss/recovery, and reversal races.
- Flutter: analyze passes; release web build passes; 102 tests pass, including the 390×844 fresh/existing PIN retry/receipt certification.
- Website: lint, type-check, and production build pass; the full Playwright suite passes 66/66 across desktop and mobile Chrome, including transfer/privacy (20), smoke (20), and public-auth pre-hydration protection (8). The production CSP was verified from the running bundle and excludes `unsafe-eval`.
- Disposable database cleanup verification: zero fixture users, policies, or attempts remain after the run; no table truncation is used.
- Firefox/WebKit local execution is not claimed: their Playwright runtimes could not be installed on this disk-constrained host. CI installs and runs the configured browser matrix; a green CI run is still required.

## Executive result

The release-mode Flutter flow passed end to end at a 390 × 844 mobile viewport:

1. Login.
2. Select **Send money → TrustPay users**.
3. Enter NGN 12.34 and a recipient email.
4. Resolve the masked recipient.
5. Review the amount, recipient, resolved name, and note.
6. Set and confirm a transaction PIN.
7. Approve the transfer with the PIN.
8. Receive a success result containing amount, masked recipient, reference, and new balance.
9. Reconcile the resulting wallet, transaction, ledger, and transfer-attempt rows.

Observed balances were exact:

| Item                     | Before |  After |
| ------------------------ | -----: | -----: |
| Sender NGN wallet        | 250.00 | 237.66 |
| Recipient NGN wallet     |  10.00 |  22.34 |
| Sender + recipient total | 260.00 | 260.00 |

The database contained exactly two `INTERNAL_TRANSFER` transaction rows, two ledger entries, and one successful internal-transfer attempt. No negative balance was present. All generated credentials stayed temporary, and the exact test users and their financial rows were deleted after each run.

Evidence artifacts:

- `WEBSITE/output/playwright/transfer-review.png`
- `WEBSITE/output/playwright/transfer-success.png`

## Verification performed

| Check                                                                                     | Result                                                                           |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Flutter release web build with production HTTPS API origin and Supabase build-time values | Passed                                                                           |
| Browser transfer happy path and PIN approval                                              | Passed                                                                           |
| Recipient masking                                                                         | Passed; full email was not returned by preview                                   |
| Decimal transfer of 12.34                                                                 | Passed                                                                           |
| Same idempotency key replay                                                               | Passed; same reference, balances unchanged                                       |
| Competing concurrent 600.00 debits against 987.66                                         | Passed; one 201, one 400, no overdraft                                           |
| Insufficient balance                                                                      | Passed; 400, no transaction rows, failed attempt recorded                        |
| Ledger reconciliation                                                                     | Passed                                                                           |
| Backend unit suites                                                                       | 354/354 passed across 52 suites                                                  |
| Financial PostgreSQL/Redis suites                                                         | 10/10 passed across financial and fault-injection suites                         |
| Flutter suite                                                                             | 102/102 passed; analyzer and release web build passed                            |
| Website transfer/privacy                                                                  | 20/20 passed on desktop and mobile Chrome                                        |
| Complete website Chromium matrix                                                          | 66/66 passed on desktop and mobile Chrome                                        |
| Public auth pre-hydration safety                                                          | 8/8 passed with JavaScript unavailable; credential-bearing controls remain inert |
| Website production CSP                                                                    | Running production bundle excludes `unsafe-eval`                                 |
| Backend production dependency audit                                                       | 0 known vulnerabilities                                                          |
| Website production dependency audit                                                       | 0 known vulnerabilities                                                          |

The original live run exposed Redis fallback risk. The remediation rerun used a real ephemeral Redis instance, deliberately disconnected the client, verified 503/no balance change/no PIN mutation, reconnected it, and completed the same transfer safely.

## What is already strong

- Protected transfer routes use `JwtAuthGuard`: `BACKEND/src/transfers/transfers.controller.ts:11-22`.
- Amount and currency inputs use DTO validation and a normalized decimal string: `BACKEND/src/transfers/dto/internal-transfer.dto.ts:42-61`.
- Money uses Prisma `Decimal`, not floating point: `BACKEND/src/transfers/transfers.service.ts:51-68`.
- Sender and recipient transaction rows, both wallet movements, wallet links, limit reservations, and the success attempt are inside one Prisma transaction: `BACKEND/src/transfers/transfers.service.ts:107-214`.
- Debit is an atomic conditional update requiring `balance >= amount`: `BACKEND/src/wallets/ledger.service.ts:49-76`.
- The ledger rejects negative before/after balances: `BACKEND/src/wallets/ledger.service.ts:134-151`.
- The Flutter UI blocks submission while busy and reuses an attempt idempotency key: `APP/lib/features/home/screens/money_action_screen.dart:1363-1365`, `APP/lib/features/home/screens/money_action_screen.dart:1584-1606`.
- Sensitive transfer and auth request bodies are omitted from Flutter debug logging: `APP/lib/services/api_client.dart:270-303`.

## Original findings and remediation requirements

The sections below preserve the review evidence that drove the plan. File line numbers reflect the original review snapshot and may have moved. Use the remediation table above and the certification record for current status.

### TP-TR-001 — Critical — The idempotency record is outside the money transaction

**Rules:** Security Rules 1 (idempotency), 2 (race conditions), and 6 (financial integrity).

**Evidence:** The interceptor creates/claims an `IN_PROGRESS` row before calling the handler, waits for the handler to finish, and only then marks the record `COMPLETED`: `BACKEND/src/common/interceptors/idempotency.interceptor.ts:98-160`, `BACKEND/src/common/interceptors/idempotency.interceptor.ts:163-176`. The actual debit and credit commit independently inside `TransfersService`: `BACKEND/src/transfers/transfers.service.ts:107-214`. The transfer tables do not store a unique business idempotency key: `BACKEND/prisma/schema.prisma:427-489`.

**Impact:** If the process crashes, the database connection fails, or final idempotency persistence fails after the transfer transaction commits, the client receives an error or no response even though money moved. The stale `IN_PROGRESS` row can be reclaimed after 120 seconds (`idempotency.interceptor.ts:19-24`, `116-126`), and the same key can execute a second transfer. A healthy same-key replay passing does not cover this post-commit failure window.

**Required fix:** Persist a user-scoped idempotency key and the transfer result in the same Prisma transaction as the debit/credit. Add a unique constraint such as `(userId, operation, idempotencyKey)`. On retry, read the committed business record and replay it. Treat Redis only as an optimization. Never delete or reclaim an idempotency record without first checking for a committed financial effect.

**Retest:** Inject failures immediately after the Prisma transaction returns but before interceptor completion; kill the process in that window; retry from a second application instance; prove exactly one debit, credit, reference, and limit reservation.

**Temporary mitigation:** Keep internal transfers disabled in production. A single application instance reduces some concurrency but does not remove the crash window.

### TP-TR-002 — High — Required transaction-PIN migration is untracked

**Rules:** Security Rules 3, 6, and production migration discipline.

**Evidence:** `BACKEND/prisma/migrations/027_transaction_pin_credentials/migration.sql` creates the server-side PIN credential table and its security controls, but `git status` reports the migration as untracked while `schema.prisma` and the PIN service are modified.

**Impact:** A deployment built from the committed repository can ship code that queries `transaction_pin_credentials` without deploying the table. PIN setup and every PIN-protected transfer would fail in production.

**Required fix:** Review and commit migration 027 with the related schema/service changes. Apply all migrations to a production-like clone, run `prisma migrate deploy`, and rehearse rollback/restore before release.

**False-positive note:** The local database already has the migration, so local tests pass; that does not make an untracked migration deployable.

### TP-TR-003 — High — Fresh-device PIN state can diverge from the server

**Rules:** Security Rules 4, 6, and transaction-authorization integrity.

**Evidence:** The app decides whether a PIN exists from a device-local hash only: `APP/lib/services/transaction_security_service.dart:35-67`. When the server says the PIN is already set, the create flow saves whatever PIN the user just entered as the local PIN: `APP/lib/features/security/screens/transaction_security_screen.dart:322-330`. The server correctly refuses a second initial PIN: `BACKEND/src/auth/auth.service.ts:526-530`.

**Impact:** On a new phone, browser, or cleared app install, an existing user sees “Set transaction PIN.” They can enter a new value; the app treats the server's 409 as success and saves that new value locally, while the server retains the old PIN. The UI then approves the wrong PIN locally and repeatedly submits it, causing transfer failures and potentially server-side PIN lockout. This is a denial-of-service and account-recovery defect, not a server authorization bypass.

**Required fix:** Add an authenticated server PIN-status endpoint. If a PIN exists, prompt for the existing PIN and verify it server-side before establishing local approval state. Route forgotten PINs through the existing current-PIN/OTP reset flow. Do not treat a generic “already set” response as proof that the newly entered local PIN matches. Longer term, use an OS-bound authorization token for biometrics instead of caching the PIN in process memory.

**Retest:** Existing user on a clean install, correct old PIN, incorrect PIN, reset by OTP, device migration, app data clear, and server lockout propagation.

### TP-TR-004 — High — Redis fails open to per-process memory

**Rules:** Security Rules 1, 2, 7, 10, and rate-limit/lockout reliability.

**Evidence:** On Redis failure the service logs a warning and continues with an in-memory map: `BACKEND/src/redis/redis.service.ts:45-54`, `65-123`. `isAvailable()` always returns true even when the mode is memory: `BACKEND/src/redis/redis.service.ts:140-153`.

**Impact:** In a multi-instance deployment, idempotency locks, rate limits, PIN failure counters, and temporary locks are no longer shared. An attacker or accidental retry can distribute attempts across instances. Restarts erase protection state. The application still accepts financial traffic even though the distributed control plane is unavailable.

**Mitigation already present:** The health endpoint returns degraded/503 for Redis failure in production: `BACKEND/src/health/health.controller.ts:27-50`. That only helps if the load balancer actually removes unhealthy instances and no traffic bypasses readiness checks.

**Required fix:** Fail startup or explicitly disable financial mutation routes when production Redis is unavailable. Use managed Redis with TLS, monitoring, failover, and restore/runbook tests. Make readiness gating part of deployment verification.

### TP-TR-005 — High — Transfer limits are currency-agnostic

**Rules:** Security Rules 6 and 8.

**Evidence:** The same nominal limits—250,000 per transfer for Tier 2 and 1,000,000 for Tier 3—apply to both supported currencies: `BACKEND/src/transfers/transfers.service.ts:26-40`; supported currencies are NGN and GHS: `BACKEND/src/transfers/dto/internal-transfer.dto.ts:16-16`, `49-51`.

**Impact:** A Tier 2 user can nominally send up to GHS 250,000 per transfer and GHS 1,000,000 per day, a radically different exposure from the NGN limits. If not explicitly approved by risk/compliance, this is a major loss and AML-control gap.

**Required fix:** Configure limits by KYC tier and currency, preferably from an audited policy table. Add tests for both currencies and boundary values. Require risk/compliance sign-off on the final numbers.

### TP-TR-006 — High — No internal-transfer reversal workflow

**Rules:** Security Rules 6, 8, 9, and operational recovery requirements.

**Evidence:** The transfer controller exposes send, preview, and get-by-reference only: `BACKEND/src/transfers/transfers.controller.ts:16-43`. No reversal operation, compensating ledger path, dual control, or reversal audit workflow exists for internal transfers.

**Impact:** Operations cannot safely correct an authorized mistake, fraud decision, or exceptional recovery case without direct database changes. Direct edits would break the ledger/audit model.

**Required fix:** Implement an idempotent, admin-authorized reversal as a new compensating transaction, never by editing original ledger rows. Require reason, actor, approval policy, available recipient funds policy, complete audit context, notification, and reconciliation tests.

### TP-TR-007 — High — Transfer audit context is incomplete

**Rules:** Security Rule 9 (audit logging).

**Evidence:** Successful attempts record IDs, reference, amount, currency, and masked identifier, but no idempotency key, actor IP, user agent, request/correlation ID, or explicit audit-log relation: `BACKEND/prisma/schema.prisma:427-450`. The business completion log similarly lacks request context: `BACKEND/src/transfers/transfers.service.ts:216-225`.

**Impact:** Incident response cannot reliably connect a customer complaint to the originating request, device/network context, idempotency claim, and ledger effect. It also weakens duplicate-payment investigation.

**Required fix:** Add a durable financial audit event inside the transfer transaction containing user, reference, idempotency key, request ID, masked counterparty, amount/currency, and trusted network/device context. Keep sensitive values masked and access-controlled.

### TP-TR-008 — High — Auth mutations, including transaction-PIN changes, bypass global idempotency

**Rules:** Security Rule 1: all mutation endpoints support idempotency keys.

**Evidence:** The global interceptor exempts every `/api/auth` route: `BACKEND/src/common/interceptors/idempotency.interceptor.ts:42-49`. PIN setup and reset are auth mutations: `BACKEND/src/auth/auth.controller.ts:132-157`.

**Impact:** Retried PIN reset/setup, password/session mutations, and their audit effects are not covered by the mandated control. A repeated reset can extend holds or create duplicate operational side effects.

**Required fix:** Replace the broad `/api/auth` exemption with an explicit, reviewed list. Apply durable idempotency to transaction-PIN setup/reset and all other state-changing auth routes where replay has side effects.

### TP-TR-009 — Medium — “Create PIN” is exposed as disabled to assistive technology

**Rules:** Production UI accessibility and reliable transaction authorization.

**Evidence:** In the release browser run the visible, tappable **Create PIN** control resolved to an ARIA button reported as disabled. A normal accessibility click timed out; a pointer hit on its visual bounds worked. The screen places the enabled action panel next to a disabled biometric `Switch`: `APP/lib/features/security/screens/transaction_security_screen.dart:156-183`, `549-595`, `650-653`.

**Impact:** Screen-reader, keyboard, and automation users may be unable to set the PIN and therefore cannot transfer money.

**Required fix:** Separate/explicitly define semantics for the action button and disabled biometric switch; avoid merged disabled state. Add Flutter widget semantics tests and release-browser keyboard/screen-reader tests.

### TP-TR-010 — Medium — Client and server disagree on note length

**Rules:** Security Rule 3 and UI validation consistency.

**Evidence:** Flutter permits up to 500 characters: `APP/lib/features/home/screens/money_action_screen.dart:6471-6481`. The API DTO permits 120: `BACKEND/src/transfers/dto/internal-transfer.dto.ts:53-56`.

**Impact:** A user can complete recipient resolution, review, and PIN approval, then receive a server rejection for a note the UI declared valid.

**Required fix:** Use one shared contract value, add a visible character counter, and test 120/121 boundaries.

### TP-TR-011 — Medium — Authenticated rate limits fall back to shared IP buckets

**Rules:** Security Rule 10 and availability.

**Evidence:** The global throttler runs before route authentication; when `req.user` is absent it uses IP: `BACKEND/src/common/guards/user-throttler.guard.ts:10-35`. During live testing, requests from different isolated users on the same source IP consumed the same transfer bucket and produced a 429 before the insufficient-balance handler ran.

**Impact:** Users behind carrier-grade NAT, corporate networks, or a shared proxy can throttle one another. A malicious client on the same visible address can deny transfers to other users.

**Required fix:** Apply an authenticated, user-scoped transfer limiter after JWT verification, with a separate IP abuse limiter. Validate the trusted-proxy chain in staging.

### TP-TR-012 — Medium — Confirmation omits fee and total debit

**Rules:** Financial UI clarity.

**Evidence:** The send review contains amount, name, recipient, and note only: `APP/lib/features/home/screens/money_action_screen.dart:2275-2296`. The backend fee is currently zero, but that is not stated.

**Impact:** Users cannot verify the full debit or confirm that the fee is zero before authorizing. This becomes unsafe if pricing changes.

**Required fix:** Display transfer amount, fee, and total debit from a server quote or authoritative fee policy. Include expiry if a quote is used.

### TP-TR-013 — Medium — No committed UI transfer E2E or real-Postgres concurrency regression test

**Rules:** Security Rules 1, 2, and release verification.

**Evidence:** Existing Flutter transfer coverage is validator/security unit coverage, not the full screen/API path. The backend phase document still calls for real PostgreSQL concurrent-transfer tests: `DOCS/REALTIME-BANKING/PHASE-04-INTERNAL-TRANSFERS.MD:72`.

**Impact:** The passing manual release run and ad-hoc database concurrency run are not automatically repeated in CI. Regressions in routing, PIN setup, idempotency, accessibility, or database isolation can ship unnoticed.

**Required fix:** Commit deterministic tests for the browser/mobile flow and real PostgreSQL: same-key replay, post-commit fault, two-instance concurrency, insufficient funds, currency mismatch, decimal boundaries, PIN lock/reset, and reversal.

### TP-TR-014 — Medium — Web “Send Money” is actually bank withdrawal

**Evidence:** The website dashboard labels the action **Send Money** but routes it to `/dashboard/withdraw`: `WEBSITE/src/app/dashboard/page.tsx:224-229`. No website client or route calls `/api/transfers/internal`.

**Impact:** Product behavior differs by platform, and web users cannot perform the reviewed TrustPay-to-TrustPay transfer despite the label.

**Required fix:** Either implement the internal-transfer flow on web or relabel the action **Withdraw to bank**. Add parity/product acceptance tests.

### TP-TR-015 — Low — Recipient preview is an account-existence oracle and returns 201

**Evidence:** Preview returns a masked success payload for eligible users and a different 404-style failure for unknown/ineligible users: `BACKEND/src/transfers/transfers.service.ts:300-333`. The POST route does not override Nest's default 201 response: `BACKEND/src/transfers/transfers.controller.ts:25-31`.

**Impact:** A rate-limited attacker can test whether email addresses are eligible TrustPay accounts. The 201 status also describes resource creation even though preview is a lookup.

**Required fix:** Perform privacy/risk sign-off on the lookup design, strengthen abuse detection, and consider a uniform response contract. Return HTTP 200 for preview.

### TP-TR-016 — Low — Idempotency keys appear in logs

**Evidence:** The interceptor logs the raw key on cache matches: `BACKEND/src/common/interceptors/idempotency.interceptor.ts:84-94`. Live request logs also included the `idempotency-key` header while authorization was redacted.

**Impact:** Anyone with log access can correlate and potentially misuse retry identifiers in combination with other compromised context.

**Required fix:** Hash or redact idempotency keys in application and HTTP logs; retain only a short correlation digest.

## Release gates

### P0 — must close before any real-money launch

- TP-TR-001: atomic business idempotency and fault-injection proof.
- TP-TR-002: commit and rehearse the PIN migration.
- TP-TR-003: server/device PIN state and recovery flow.
- TP-TR-004: production Redis fail-closed/readiness behavior.
- TP-TR-005: approved per-currency limits.
- TP-TR-006 and TP-TR-007: safe reversal and complete financial audit trail.
- TP-TR-008: idempotency coverage for PIN and other auth mutations.

### P1 — close before broad rollout

- Fix Create-PIN accessibility semantics.
- Align note validation and show fee/total debit.
- Separate authenticated user rate limiting from IP abuse limiting.
- Commit full UI and PostgreSQL concurrency/fault regression tests.
- Resolve web product parity and preview privacy/status behavior.

## Required production certification rerun

After the P0 fixes, repeat the following against production-like PostgreSQL and Redis with at least two API instances:

1. Fresh user and existing user on a fresh device.
2. Correct, incorrect, locked, reset, and recently-reset PIN states.
3. NGN and GHS minimum, maximum, daily, and monthly boundaries.
4. Same-key replay and different-body/same-key conflict.
5. Process kill after ledger commit but before response/idempotency completion.
6. Two simultaneous near-full-balance transfers.
7. Redis outage and recovery while traffic is active.
8. Reversal, reconciliation, notifications, and audit evidence.
9. Screen reader, keyboard, small phone, large phone, and offline/retry states.
10. Canary release with balance/ledger/idempotency mismatch alerts at zero tolerance.

The core transfer transaction is promising and passed the normal and concurrent balance checks. Production approval should remain blocked until the atomic-idempotency boundary and the P0 operational controls are proven under failure, not only under the happy path.
