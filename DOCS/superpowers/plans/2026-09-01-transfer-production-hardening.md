# Internal Transfer Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close TP-TR-001 through TP-TR-016 and make TRUSTPAY internal transfers safe to enable for real-money production behind a controlled rollout.

**Architecture:** PostgreSQL is the source of truth for exactly-once financial effects: the idempotency fingerprint, response snapshot, transfer pair, ledger entries, limit reservations, and audit event commit in one Prisma transaction. Redis remains mandatory for distributed rate limiting and PIN lockout in deployed environments, but it is never the sole proof that money moved. PIN state is server-authoritative, reversals are append-only compensating transfers with four-eyes approval, and mobile/web clients render an authoritative server contract.

**Tech Stack:** NestJS, Prisma, PostgreSQL 16, Redis 7, Pino, Jest, Flutter/Riverpod/Dio, Next.js 16, TanStack Query, Playwright, GitHub Actions.

**Spec:** `DOCS/TRANSFER-PRODUCTION-READINESS-REVIEW.md`

## Global Constraints

- Follow all 15 sections of `DOCS/SECURITY-RULES.MD`.
- Every state-changing endpoint requires an idempotency key and must replay its original terminal response.
- All balance, limit, reversal, and financial-audit writes use one Prisma transaction with a five-second timeout.
- Every money value remains a Prisma `Decimal` or a validated two-decimal string; never use JavaScript `number`, Dart `double`, or `parseFloat` for submitted amounts.
- Wallet balances never become negative; reversals block for operations review when recipient funds are insufficient.
- All protected routes use `JwtAuthGuard`; admin reversal routes also use `RolesGuard` and `@Roles('ADMIN')`.
- Never persist or log plaintext PINs, tokens, OTPs, full recipient identifiers, or raw idempotency keys.
- Existing user changes in the dirty worktree must be preserved and reviewed before any implementation commit.
- `INTERNAL_TRANSFERS_ENABLED` stays `false` in production until every P0 gate in Task 13 passes.
- GHS transfers stay disabled until Risk/Compliance records approved GHS limits; engineering must not invent those numbers.
- Reversal approval policy and retention above the existing 90-day minimum require Operations/Compliance sign-off.

## Workstream and release order

| Wave | Tasks | Release effect |
|---|---|---|
| 0 — Contain | 1–2 | Deploy-safe baseline; transfers remain disabled |
| 1 — Financial core | 3–5 | Exactly-once transfer, currency policy, safe reversal |
| 2 — Security/operations | 6–8 | Server-authoritative PIN, mandatory Redis, audit/reconciliation |
| 3 — Product surfaces | 9–11 | Flutter accessibility/contract, web parity, preview/log privacy |
| 4 — Certification | 12–13 | Automated failure tests, canary, production go/no-go |

---

### Task 1: Add a fail-closed internal-transfer release switch

**Findings:** Temporary mitigation for TP-TR-001 through TP-TR-008.

**Files:**
- Create: `BACKEND/src/transfers/guards/internal-transfers-availability.guard.ts`
- Create: `BACKEND/src/transfers/guards/internal-transfers-availability.guard.spec.ts`
- Modify: `BACKEND/src/transfers/transfers.controller.ts`
- Modify: `BACKEND/src/transfers/transfers.module.ts`
- Modify: `BACKEND/src/app.module.ts`
- Modify: `BACKEND/.env.example`
- Modify: `BACKEND/scripts/validate-production-config.sh`
- Modify: `docker-compose.prod.yml`
- Modify: `render.yaml`

**Interfaces:**
- Produces: `InternalTransfersAvailabilityGuard.canActivate(context): boolean`.
- Configuration: `INTERNAL_TRANSFERS_ENABLED=true|false`, defaulting to `false`; production validation requires an explicit value.
- Failure contract: HTTP 503 with code `INTERNAL_TRANSFERS_UNAVAILABLE`.

- [x] Write guard tests proving the mutation route is unavailable when the flag is absent/false and available only when explicitly true.
- [x] Implement the guard with `ConfigService`; apply it only to `POST /api/transfers/internal` so transfer history remains readable during an incident.
- [x] Add manifest/config validation that rejects a production deployment with an absent or non-boolean value.
- [x] Set all committed production manifests to `false`; enabling is a separate release action after Task 13.
- [x] Run `cd BACKEND && npm test -- internal-transfers-availability.guard.spec.ts --runInBand` and `npm run build`; expect PASS.
- [ ] Commit only the switch files with message `feat(transfers): add fail-closed release switch`.

### Task 2: Make the migration baseline deployable and reproducible

**Findings:** TP-TR-002.

**Files:**
- Review and commit: `BACKEND/prisma/migrations/026_webhook_payload_version_idempotency/migration.sql`
- Review and commit: `BACKEND/prisma/migrations/027_transaction_pin_credentials/migration.sql`
- Review and commit: `BACKEND/prisma/migrations/028_server_only_table_rls/migration.sql`
- Modify if drift is found: `BACKEND/prisma/schema.prisma`
- Verify: `BACKEND/scripts/check-migration-drift.sh`
- Verify: `BACKEND/scripts/verify-backup-restore.sh`

**Interfaces:**
- Produces: a clean, ordered Prisma migration history through migration 028.

- [x] Review the three untracked migrations against their corresponding schema and service changes; verify no secret or environment-specific data is present.
- [x] Create a fresh PostgreSQL database and run `cd BACKEND && npm run db:generate && npm run db:deploy`; expect all migrations through 028 to apply once.
- [x] Run `BACKEND/scripts/check-migration-drift.sh` with disposable primary and shadow databases; expect no drift.
- [x] Run `BACKEND/scripts/verify-backup-restore.sh` against a disposable restore database; expect schema and data verification to pass.
- [x] Verify `anon` and `authenticated` cannot select PIN, ledger, idempotency, audit, or transfer-attempt tables while the NestJS service role can.
- [x] Commit the reviewed migration/schema group with message `chore(db): deploy transaction PIN and server-only RLS migrations`.

### Task 3: Put business idempotency inside the financial transaction

**Findings:** TP-TR-001 and the financial portion of TP-TR-007/016.

**Files:**
- Create: `BACKEND/prisma/migrations/029_internal_transfer_atomic_idempotency/migration.sql`
- Modify: `BACKEND/prisma/schema.prisma`
- Create: `BACKEND/src/transfers/internal-transfer-request-context.ts`
- Create: `BACKEND/src/transfers/internal-transfer-idempotency.service.ts`
- Create: `BACKEND/src/transfers/internal-transfer-idempotency.service.spec.ts`
- Modify: `BACKEND/src/transfers/transfers.controller.ts`
- Modify: `BACKEND/src/transfers/transfers.service.ts`
- Modify: `BACKEND/src/transfers/transfers.service.spec.ts`
- Modify: `BACKEND/src/transfers/transfers.module.ts`

**Interfaces:**
- `InternalTransferRequestContext = { idempotencyKey: string; requestId: string; ipAddress: string; userAgent?: string }`.
- `InternalTransferIdempotencyService.hashKey(key): string` returns a SHA-256 digest; raw keys never enter logs or business tables.
- `InternalTransferIdempotencyService.fingerprint(dto): string` hashes a canonical object containing normalized recipient, amount, currency, and note but excluding the PIN.
- Extend successful `InternalTransferAttempt` rows with `idempotencyKeyHash`, `requestHash`, `response`, `requestId`, `ipAddress`, and `userAgent`.
- Add `PROCESSING` to `InternalTransferAttemptStatus`; it exists only inside the uncommitted transaction and is changed to `SUCCESS` before commit.
- Add unique constraint `(userId, idempotencyKeyHash)`; legacy/failed rows may keep the digest null.

The service flow must follow this shape:

```typescript
const keyHash = idempotency.hashKey(context.idempotencyKey);
const requestHash = idempotency.fingerprint(dto);
const replay = await idempotency.findCompleted(userId, keyHash, requestHash);
if (replay) return replay;

try {
  return await prisma.$transaction(async (tx) => {
    const attempt = await idempotency.createProcessing(
      tx,
      userId,
      keyHash,
      requestHash,
      context,
    );
    const response = await executeTransferAndAudit(tx, attempt.id, dto);
    await idempotency.complete(tx, attempt.id, response);
    return response;
  }, { maxWait: 2_000, timeout: 5_000 });
} catch (error) {
  if (isBusinessKeyConflict(error)) {
    return idempotency.replayCommitted(userId, keyHash, requestHash);
  }
  throw error;
}
```

- [x] Write schema/service tests for same-key replay, different-body conflict, simultaneous same-key requests, and a retry after post-commit response failure.
- [x] Add migration 029 with nullable backfill-safe columns and the unique user/digest constraint; enable RLS and revoke Data API access in the same migration.
- [x] Extract and validate `Idempotency-Key` in the controller, derive request context from the trusted Express request, and cap user agent at 256 characters.
- [x] At service entry, look up a completed attempt by `(userId, idempotencyKeyHash)`; replay its stored response when the request hash matches and return 409 when it differs.
- [x] Inside the existing Prisma transaction, create a processing attempt, reserve limits, create both transactions, write both ledgers, attach wallet IDs, store the response snapshot, and mark the attempt successful.
- [x] Use Prisma transaction options `{ maxWait: 2000, timeout: 5000 }`; keep the atomic conditional debit and negative-balance guard.
- [x] Catch only the unique-key conflict outside the transaction, then re-read and replay the committed attempt. Allow other failures to roll back without deleting a committed financial proof.
- [x] Write the financial `AuditLog` row in the same transaction with user ID, both transaction IDs, amount/currency, before/after status, IP, request ID, masked counterparty, and idempotency digest.
- [x] Remove raw idempotency values from Pino calls and use the first 12 characters of the digest only for correlation.
- [x] Run focused Jest suites and `npm run build`; expect the original 27 tests plus new idempotency cases to pass.
- [ ] Commit with message `fix(transfers): make financial idempotency atomic`.

### Task 4: Move transfer limits to an audited per-currency policy

**Findings:** TP-TR-005.

**Files:**
- Create: `BACKEND/prisma/migrations/030_internal_transfer_limit_policies/migration.sql`
- Modify: `BACKEND/prisma/schema.prisma`
- Create: `BACKEND/src/transfers/internal-transfer-limit.service.ts`
- Create: `BACKEND/src/transfers/internal-transfer-limit.service.spec.ts`
- Modify: `BACKEND/src/transfers/transfers.service.ts`
- Modify: `BACKEND/src/admin/admin.controller.ts`
- Create: `BACKEND/src/admin/dto/internal-transfer-limit-policy.dto.ts`
- Modify: `BACKEND/src/admin/admin.service.ts`
- Modify: `BACKEND/src/admin/admin.service.spec.ts`

**Interfaces:**
- `InternalTransferLimitPolicy` has currency, KYC tier, per-transaction/daily/monthly Decimal values, enabled flag, version, approver, reason, and effective timestamps.
- `InternalTransferLimitService.getActivePolicy(currency, tier)` returns one enabled policy or fails closed with `TRANSFER_POLICY_UNAVAILABLE`.
- GHS rows are inserted disabled; NGN rows mirror current values but production enablement still requires recorded approval.

- [x] Write tests proving NGN and GHS use different rows, disabled/missing policy fails closed, and exact boundary/one-minor-unit-over values behave correctly.
- [x] Add the policy model and indexes; seed disabled GHS policies and versioned NGN policies in migration 030 using Decimal columns.
- [x] Replace `INTERNAL_TRANSFER_LIMITS` constants with the policy service inside the same financial transaction.
- [x] Add admin read/change endpoints guarded by JWT and ADMIN role; require reason and a second admin approver before activation.
- [x] Write an audit event for every requested, approved, activated, and disabled policy version.
- [ ] Obtain written Risk/Compliance values and approvals outside code; record them through the admin workflow. Keep the affected currency disabled until approval exists.
- [x] Run service/admin tests plus both-currency PostgreSQL boundary tests; expect no cross-currency policy reuse.
- [ ] Commit with message `feat(transfers): add approved currency-specific limits`.

### Task 5: Add an append-only, four-eyes reversal workflow

**Findings:** TP-TR-006.

**Files:**
- Create: `BACKEND/prisma/migrations/031_internal_transfer_reversals/migration.sql`
- Modify: `BACKEND/prisma/schema.prisma`
- Create: `BACKEND/src/transfers/dto/internal-transfer-reversal.dto.ts`
- Create: `BACKEND/src/transfers/internal-transfer-reversal.controller.ts`
- Create: `BACKEND/src/transfers/internal-transfer-reversal.service.ts`
- Create: `BACKEND/src/transfers/internal-transfer-reversal.service.spec.ts`
- Modify: `BACKEND/src/transfers/transfers.module.ts`
- Modify: `BACKEND/src/transfers/transfers.service.ts`
- Modify: `WEBSITE/src/app/admin/page.tsx`
- Modify: `WEBSITE/src/services/api.ts`

**Interfaces:**
- `POST /api/admin/transfers/internal/:reference/reversals` creates a `PENDING_APPROVAL` request with reason and idempotency key.
- `POST /api/admin/transfers/internal/reversals/:id/approve` requires a different admin and completes one full reversal.
- `POST /api/admin/transfers/internal/reversals/:id/reject` records reviewer and reason.
- One original transfer may have at most one completed/full reversal; partial and force-negative reversal are not supported.

Approval must create a new ledger pair, never update the original pair:

```typescript
await prisma.$transaction(async (tx) => {
  const reversal = await claimPendingReversal(tx, reversalId, approvingAdminId);
  const recipientDebit = await ledger.debitWallet(reverseDebitInput(reversal), tx);
  const senderCredit = await ledger.creditWallet(reverseCreditInput(reversal), tx);
  await completeReversalAndAudit(tx, reversal, recipientDebit, senderCredit);
}, { maxWait: 2_000, timeout: 5_000 });
```

- [x] Write tests for requester-cannot-approve, duplicate request/replay, already-reversed, wrong currency, insufficient recipient balance, and concurrent approvals.
- [x] Add reversal status/model with original attempt, reversal reference, both compensating transaction IDs, requester, approver, reasons, timestamps, and unique original-transfer constraint.
- [x] Implement request/reject without changing money; write audited state transitions.
- [x] Implement approval as one Prisma transaction: atomically debit the original recipient, credit the original sender, create new `REVERSED`/compensating transaction and ledger rows, link the reversal, and audit both before/after states.
- [x] If funds are insufficient, leave the request `BLOCKED`, preserve zero negative balance, and require Operations case handling; never edit the original ledger rows.
- [x] Update original transfer lookup to expose `reversalStatus` and compensating reference without changing original history.
- [x] Add the minimal admin queue/detail controls and require explicit confirmation showing amount, currency, users, reason, and requester.
- [x] Run service, PostgreSQL concurrency, admin authorization, and UI tests; expect total value conservation before and after reversal.
- [ ] Commit with message `feat(transfers): add audited four-eyes reversals`.

### Task 6: Make transaction PIN state server-authoritative and idempotent

**Findings:** TP-TR-003 and TP-TR-008.

**Files:**
- Create: `BACKEND/src/auth/dto/verify-transaction-pin.dto.ts`
- Create: `BACKEND/prisma/migrations/032_sensitive_idempotency_responses/migration.sql`
- Modify: `BACKEND/prisma/schema.prisma`
- Modify: `BACKEND/src/auth/auth.controller.ts`
- Modify: `BACKEND/src/auth/auth.service.ts`
- Modify: `BACKEND/src/auth/auth.controller.spec.ts`
- Modify: `BACKEND/src/auth/auth.service.spec.ts`
- Modify: `BACKEND/src/common/interceptors/idempotency.interceptor.ts`
- Modify: `BACKEND/src/common/interceptors/idempotency.interceptor.spec.ts`
- Create: `BACKEND/src/common/services/idempotency-response-crypto.service.ts`
- Create: `BACKEND/src/common/services/idempotency-response-crypto.service.spec.ts`
- Modify: `BACKEND/src/app.module.ts`
- Modify: `BACKEND/.env.example`
- Modify: `APP/lib/services/auth_service.dart`
- Modify: `APP/lib/services/transaction_security_service.dart`
- Modify: `APP/lib/features/security/screens/transaction_security_screen.dart`
- Create: `APP/test/transaction_pin_server_state_test.dart`

**Interfaces:**
- `GET /api/auth/transaction-pin/status` returns `{ configured, pinLength, resetHoldUntil, locked }` without hashes or attempt counts.
- `POST /api/auth/transaction-pin/verify` verifies an existing PIN and returns `{ verified: true }`.
- Setup/reset/verify accept and replay idempotency keys; no plaintext PIN or replay response is logged.
- Flutter reads server status first; local secure storage is only a device UX cache, never proof that the server PIN changed.
- Token-bearing auth responses use AES-256-GCM encrypted idempotency fields (`responseCiphertext`, `responseIv`, `responseTag`, `encryptionKeyId`) instead of the plaintext JSON column. `IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY` is a versioned 32-byte key supplied by the production secrets manager.

Flutter must choose the PIN screen from server state:

```dart
final status = await authService.getTransactionPinStatus();
if (!status.configured) {
  return openCreatePin();
}
final pin = await openVerifyExistingPin();
await authService.verifyTransactionPin(pin);
await transactionSecurity.saveVerifiedDevicePin(pin);
```

- [x] Write backend tests for absent/existing/locked/recently-reset credentials, setup replay, reset replay, and wrong-PIN lockout.
- [x] Add status and verify routes under `JwtAuthGuard` and sensitive-route throttling.
- [x] Add migration 032 and the AES-256-GCM service; validate key length at startup, store a key ID for rotation, authenticate ciphertext with route/scope/key digest as additional authenticated data, and never fall back to plaintext for token-bearing routes.
- [x] Remove the blanket `/api/auth` exclusion from the interceptor. Classify every auth POST/PATCH explicitly: safe responses use ordinary replay; token-bearing responses use encrypted replay storage; webhook-owned idempotency remains separate.
- [x] Add a CI test enumerating auth mutation routes and failing if any route lacks an idempotency policy.
- [x] Change Flutter setup logic so HTTP 409 never calls `savePin`; refresh server status and ask the user to verify the existing PIN or enter the reset flow.
- [x] On a fresh device with `configured=true`, verify the entered PIN against the server before establishing the local hash/ephemeral approval session.
- [x] Namespace or clear local PIN state when the authenticated user changes, and clear ephemeral PIN material on logout/background timeout.
- [x] Run backend auth/PIN suites and Flutter service/widget tests; verify fresh install, cleared storage, old PIN, wrong PIN, OTP reset, reset hold, and lockout.
- [ ] Commit backend and Flutter changes separately: `fix(auth): make PIN state server authoritative` and `fix(app): reconcile transaction PIN across devices`.

### Task 7: Require Redis for deployed financial and authentication controls

**Findings:** TP-TR-004 and TP-TR-011.

**Files:**
- Modify: `BACKEND/src/redis/redis.service.ts`
- Create: `BACKEND/src/redis/redis.service.spec.ts`
- Modify: `BACKEND/src/health/health.controller.ts`
- Modify: `BACKEND/src/health/health.controller.spec.ts`
- Create: `BACKEND/src/common/guards/authenticated-user-throttler.guard.ts`
- Create: `BACKEND/src/common/guards/authenticated-user-throttler.guard.spec.ts`
- Modify: `BACKEND/src/common/guards/user-throttler.guard.ts`
- Modify: `BACKEND/src/transfers/transfers.controller.ts`
- Modify: `BACKEND/src/app.module.ts`
- Modify: `BACKEND/.env.example`
- Modify: `render.yaml`
- Modify: `docker-compose.prod.yml`

**Interfaces:**
- `RedisService.isAvailable()` becomes the real ready state.
- In-memory fallback is permitted only when `NODE_ENV` is `development` or `test` and `REDIS_ALLOW_MEMORY_FALLBACK=true`.
- `/api/health/live` proves process liveness; `/api/health/ready` requires database and Redis.
- Transfer rate limiting has two independent trackers: a broad IP abuse limit and a five-per-minute verified-user limit.

The deployed-mode decision is explicit:

```typescript
const canUseMemory = ['development', 'test'].includes(nodeEnv) &&
  config.get<boolean>('REDIS_ALLOW_MEMORY_FALLBACK') === true;
if (!redisReady && !canUseMemory) {
  throw new ServiceUnavailableException('Distributed controls unavailable');
}
```

- [x] Write Redis tests proving deployed startup/readiness fails when Redis is absent and development fallback requires explicit opt-in.
- [x] Remove per-process fallback from production/staging code paths; make failed Redis commands fail closed for transfer, PIN, OTP, and auth lockout operations.
- [x] Split liveness/readiness endpoints and configure deployment health checks to use readiness.
- [x] Keep the global IP abuse limiter, then apply `JwtAuthGuard` followed by `AuthenticatedUserThrottlerGuard` on transfers so only a verified `userId` forms the user bucket.
- [x] Validate trusted proxy configuration and reject untrusted forwarded-for chains.
- [x] Run a two-instance test: users sharing one IP retain independent user buckets; one user cannot evade the limit by switching instances.
- [x] Add alerts for Redis disconnects, readiness removal, rate-limit spikes, and PIN-lock spikes.
- [ ] Commit with message `fix(infra): fail closed on distributed control loss`.

### Task 8: Complete audit context, reconciliation, and zero-tolerance alerts

**Findings:** TP-TR-007 and operational closure for TP-TR-001/006.

**Files:**
- Create: `BACKEND/src/common/services/request-audit-context.ts`
- Create: `BACKEND/src/common/services/request-audit-context.spec.ts`
- Modify: `BACKEND/src/common/types/request-context.ts`
- Modify: `BACKEND/src/common/services/reconciliation.service.ts`
- Modify: `BACKEND/src/common/services/reconciliation.service.spec.ts`
- Modify: `BACKEND/src/admin/admin.controller.ts`
- Modify: `BACKEND/src/admin/admin.service.ts`
- Modify: `WEBSITE/src/app/admin/audit/page.tsx`
- Create: `DOCS/PRODUCTION-GUIDES/19-INTERNAL-TRANSFER-OPERATIONS.md`

**Interfaces:**
- `RequestAuditContext` normalizes request ID, trusted client IP, bounded user agent, actor ID, and idempotency digest.
- Reconciliation scope `INTERNAL_TRANSFERS` checks transfer pairs, ledger pairs, amount/currency equality, attempt links, response snapshots, limit usage, and reversal pairs.
- Any mismatch creates a `BLOCKED` reconciliation run and pages operations; no tolerance is allowed for count or value mismatch.

- [x] Write request-context tests for direct clients, trusted proxies, missing headers, and oversized user agents.
- [x] Use one request-context helper in transfer, PIN, limit-policy, and reversal audit events.
- [x] Add internal-transfer reconciliation queries and tests for missing leg, unequal amount, wrong currency, orphan attempt, duplicate business key, bad limit usage, and broken reversal.
- [x] Add an admin endpoint and UI filters for transfer reference, request ID, user, action, time, and reversal state; keep identifiers masked.
- [x] Configure hourly transfer reconciliation plus the existing daily wallet run, with alerting on `BLOCKED`, `FAILED`, or nonzero mismatches.
- [x] Document incident freeze, user communication, evidence capture, reversal approval, Redis outage, reconciliation mismatch, and recovery steps.
- [ ] Verify logs are retained at least 90 days and access is restricted/audited; obtain Compliance approval for any longer required period.
- [ ] Commit with message `feat(ops): reconcile and audit internal transfers`.

### Task 9: Align and accessibility-test the Flutter transfer experience

**Findings:** TP-TR-009, TP-TR-010, and TP-TR-012.

**Files:**
- Modify: `APP/lib/features/security/screens/transaction_security_screen.dart`
- Modify: `APP/lib/features/home/screens/money_action_screen.dart`
- Modify: `APP/test/money_action_validation_test.dart`
- Create: `APP/test/transaction_security_semantics_test.dart`
- Create: `APP/test/internal_transfer_review_test.dart`

**Interfaces:**
- Transfer note maximum is exactly 120 Unicode code points on client and server.
- Review rows always include `Amount`, `Fee`, and `Total debit`; fee is `0.00` until an approved server fee policy exists.
- The Create/Change PIN action and disabled biometric switch expose independent semantics nodes.

- [x] Write a Flutter semantics test that finds an enabled tappable `Create PIN` button while the biometric switch is disabled.
- [x] Isolate button and switch semantics; give both explicit labels, values, enabled state, and minimum 48×48 tap targets.
- [x] Change note validation/counter to 120 and add 120/121 boundary tests.
- [x] Add `Fee 0.00 <currency>` and `Total debit <amount> <currency>` to the review dialog and receipt contract; never calculate a nonzero fee client-side.
- [x] Add widget tests for small/large text scale, keyboard focus order, screen-reader labels, double tap, offline retry, and final receipt.
- [x] Run `cd APP && flutter analyze --no-fatal-infos && flutter test`; expect no failures.
- [ ] Commit with message `fix(app): harden transfer review and accessibility`.

### Task 10: Implement real web internal-transfer parity

**Findings:** TP-TR-014.

**Files:**
- Create: `WEBSITE/src/app/dashboard/send/page.tsx`
- Create: `WEBSITE/src/components/transfers/internal-transfer-form.tsx`
- Create: `WEBSITE/src/lib/transfer-contract.ts`
- Modify: `WEBSITE/src/services/api.ts`
- Modify: `WEBSITE/src/app/dashboard/page.tsx`
- Modify: `WEBSITE/src/app/dashboard/wallet/[currency]/page.tsx`
- Modify: `WEBSITE/src/components/layout/dashboard-layout.tsx`
- Create: `WEBSITE/e2e/internal-transfer.spec.ts`

**Interfaces:**
- `transferApi.previewRecipient`, `transferApi.sendInternal`, `transferApi.getByReference`, and PIN status/setup/verify methods use validated string amounts and explicit attempt idempotency keys.
- `/dashboard/send` is TrustPay-to-TrustPay transfer; `/dashboard/withdraw` remains bank withdrawal and is labelled accordingly.

- [x] Write Playwright tests for recipient masking, review, PIN setup/existing PIN, same-key retry, success receipt, validation failure, 429, and insufficient funds.
- [x] Add typed API response/request contracts; reject scientific notation, negative values, more than two decimals, and notes over 120 before submission.
- [x] Build the send page with recipient resolution, amount/currency, note counter, fee/total review, PIN authorization, one in-flight attempt, and receipt.
- [x] Keep the same idempotency key for retries of an unchanged attempt; generate a new key after final outcome or material form change.
- [x] Change dashboard and wallet Send Money links to `/dashboard/send`; label `/dashboard/withdraw` as `Withdraw to bank` everywhere.
- [ ] Run `cd WEBSITE && npm run lint && npm run build && npm run test:e2e`; expect all configured browser projects to pass.
- [ ] Commit with message `feat(web): add internal transfer parity`.

### Task 11: Close recipient-preview privacy/status and log-redaction gaps

**Findings:** TP-TR-015 and TP-TR-016.

**Files:**
- Modify: `BACKEND/src/transfers/transfers.controller.ts`
- Modify: `BACKEND/src/transfers/transfers.service.ts`
- Modify: `BACKEND/src/transfers/transfers.service.spec.ts`
- Modify: `BACKEND/src/common/interceptors/idempotency.interceptor.ts`
- Modify: `BACKEND/src/common/interceptors/idempotency.interceptor.spec.ts`
- Modify: `BACKEND/src/main.ts`
- Modify: `APP/lib/services/api_client.dart`
- Modify: `WEBSITE/src/services/api.ts`

**Interfaces:**
- Preview always returns HTTP 200; ineligible/unknown recipients use one generic response/error shape and bounded timing.
- Pino redacts `authorization`, `cookie`, `set-cookie`, `transactionPin`, `otp`, and both idempotency-key header spellings.
- Application logs contain only a short digest, never the raw idempotency key.

- [x] Write tests proving preview uses 200, masks eligible recipients, gives the same ineligible response for unknown/suspended/unverified users, and never returns a full identifier.
- [x] Add `@HttpCode(HttpStatus.OK)` and normalize not-eligible behavior; preserve the sender/self-transfer protections.
- [ ] Keep strict verified-user and IP throttles, add enumeration monitoring, and record Product Security's accepted residual risk because successful lookup must remain distinguishable for usable transfer confirmation.
- [x] Configure Pino header/body redaction and replace raw-key logs with digest prefixes.
- [x] Extend Flutter and web log-redaction tests to cover PIN status/verify and idempotency headers.
- [x] Run backend, Flutter API-security, and website privacy tests; inspect captured logs for zero sensitive values.
- [ ] Commit with message `fix(security): reduce transfer enumeration and redact retry keys`.

### Task 12: Commit production-grade financial E2E and fault tests

**Findings:** TP-TR-013 and regression proof for every P0 financial control.

**Files:**
- Create: `BACKEND/test/internal-transfer.financial.e2e-spec.ts`
- Create: `BACKEND/test/internal-transfer.fault.e2e-spec.ts`
- Create: `BACKEND/test/support/transfer-fixtures.ts`
- Create: `BACKEND/src/transfers/transfer-post-commit.hook.ts`
- Modify: `BACKEND/test/jest-e2e.json`
- Modify: `BACKEND/package.json`
- Create: `APP/integration_test/internal_transfer_flow_test.dart`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- `TransferPostCommitHook.afterCommit()` is a production no-op and is overridden only by the test application to terminate/fail after database commit but before HTTP/idempotency-interceptor completion.
- `npm run test:financial:e2e` runs against real PostgreSQL and Redis, never Prisma mocks.

The post-commit retry assertion is exact:

```typescript
expect(senderBalanceAfter).toEqual(senderBalanceBefore.minus(amount));
expect(recipientBalanceAfter).toEqual(recipientBalanceBefore.plus(amount));
expect(successfulAttempts).toHaveLength(1);
expect(transferTransactions).toHaveLength(2);
expect(ledgerEntries).toHaveLength(2);
expect(retryResponse.reference).toBe(firstCommittedReference);
```

- [x] Write real-database tests for decimal boundaries, insufficient balance, currency mismatch, same-key replay, different-body conflict, two near-full-balance debits, and two API instances.
- [x] Add the post-commit test hook and prove a killed first instance followed by retry on the second instance returns the original response with exactly one debit, credit, limit reservation, and audit event.
- [x] Add Redis outage/recovery tests proving deployed transfer/PIN mutations return 503 and do not touch balances while Redis is unavailable.
- [x] Add reversal tests for concurrent approval, insufficient funds, duplicate key, and conservation of total wallet value.
- [x] Add Flutter integration coverage for fresh/existing PIN, review semantics, submit/retry, and receipt at a 390×844 viewport.
- [x] Update CI to run migrations, focused financial E2E, Flutter integration web build, and Playwright transfer flows with PostgreSQL and Redis services.
- [x] Ensure every test creates unique fixtures and deletes only those exact IDs; never truncate shared tables.
- [ ] Run the full CI command set locally and commit with message `test(transfers): add financial fault and UI certification`.

### Task 13: Production certification, canary, and final enablement

**Findings:** Closure gate for TP-TR-001 through TP-TR-016.

**Files:**
- Modify: `DOCS/TRANSFER-PRODUCTION-READINESS-REVIEW.md`
- Modify: `DOCS/PRODUCTION-GUIDES/19-INTERNAL-TRANSFER-OPERATIONS.md`
- Create: `DOCS/PRODUCTION-GUIDES/20-INTERNAL-TRANSFER-CERTIFICATION.md`
- Modify only after approval: production environment `INTERNAL_TRANSFERS_ENABLED`

**Interfaces:**
- Certification record includes build SHA, migration version, policy versions, Redis topology, test evidence, approvers, rollback owner, and reconciliation baseline.

- [ ] Deploy the exact release candidate to staging with production-like PostgreSQL, managed Redis/TLS, and at least two backend instances.
- [ ] Run the certification matrix: new/existing device PIN, NGN/GHS approved boundaries, same-key replay, changed-body conflict, process kill, concurrent debits, Redis outage/recovery, reversal, reconciliation, accessibility, offline/retry, and web/mobile parity.
- [ ] Confirm database migration 032 or later is deployed with no drift and a tested restore point exists.
- [ ] Confirm zero critical/high security findings, zero ledger/attempt mismatches, zero negative balances, and zero raw secrets/PINs/idempotency keys in logs.
- [ ] Obtain Security, Backend, Mobile/Web, Operations, Risk/Compliance, and release-owner approval in the certification document.
- [ ] Enable the feature for internal staff only; monitor error, lockout, duplicate-key, Redis, ledger, reconciliation, and reversal metrics for 24 hours.
- [ ] Expand to 1%, 10%, 25%, 50%, then 100%, holding at least one business day per stage; automatically disable on any financial mismatch or unexplained duplicate.
- [ ] After stable 100% rollout, mark each TP-TR finding closed with linked test/monitor evidence and keep the kill switch/runbook permanently.
- [ ] Commit certification evidence with message `docs(transfers): certify production rollout`.

## Definition of production-ready

Production approval requires all of the following at the same release SHA:

- Atomic post-commit retry proof shows one and only one financial effect.
- All migrations are tracked, deploy cleanly, restore cleanly, and have no Prisma drift.
- Server PIN status works across fresh devices, reset, lock, and recovery states.
- Redis loss removes instances from readiness and blocks sensitive mutations without touching money.
- Every enabled currency/tier has an approved, versioned policy.
- Reversal is compensating, idempotent, four-eyes approved, and never forces a negative balance.
- Financial audit and reconciliation can trace every transfer from request to both ledgers and any reversal.
- Flutter and web pass semantics, validation, retry, and receipt E2E tests.
- Preview and logging tests prove masking/redaction contracts.
- Canary completes with zero financial mismatches and documented cross-functional approval.

## Estimated delivery

With one backend engineer, one Flutter/web engineer, and shared QA/DevOps review:

- Wave 0: 1–2 working days.
- Wave 1: 7–10 working days.
- Wave 2: 5–7 working days.
- Wave 3: 4–6 working days.
- Wave 4: 3–5 working days plus canary observation time.

Expected elapsed time is approximately four to six weeks, depending on Risk/Compliance limit approval, reversal-policy approval, and staging infrastructure availability. No schedule pressure changes the P0 exit criteria.
