# Money-flow audit fixes implementation plan

> **For agentic workers:** Use superpowers:executing-plans for root integration and dispatching-parallel-agents for independent domains. Each task uses red/green regression tests.

**Goal:** Close F1–F7 in DOCS/MONEY-FLOW-AUDIT-2026-11-02.md without changing approved rates, KYC tiers or real customer balances.
**Architecture:** Bind withdrawal/VTU requests atomically through unique stable references; preserve durable replay across cache faults. Route verified adverse funding to persistent operational controls, use terminal-aware VTU transitions, and support audited manual payout handover.
**Tech Stack:** NestJS, Prisma/PostgreSQL, Redis, Next.js, Flutter.
**Spec:** DOCS/MONEY-FLOW-AUDIT-2026-11-02.md; user authorized implementation and full verification in this chat.

## Global constraints
- Preserve unrelated working-tree changes. No commits, deployment, live financial mutations or automatic real transfers.
- Decimal arithmetic, no negative balances, DTO/JWT/admin guards, idempotency and audit trail throughout.
- External provider calls outside database transactions; provider references stable through all retries.

## Review focus
- Lost response after committed debit must recover original operation even after generic replay lease/TTL.
- Concurrent retries and changed business fields must never dispatch twice or reuse the wrong operation.
- Adverse funding callbacks must be independently correlated, with uncertainty retained for review and no blind negative debit.
- Terminal VTU outcomes must survive late pending/timeout responses and exhausted retry recovery.
- Operator handover must never imply safe resend when external payout outcome is uncertain.

### Task 1 — F1 durable withdrawal/VTU request binding (root)
Files: common financial request helper/tests; payment and VTU controllers/services; interceptor; financial tests.
- [x] Reproduce post-commit Redis/persistence failure and stale retry; assert one debit/reference/provider dispatch under retry/concurrency.
- [x] Validate client key, fingerprint business DTO without PIN, derive stable user/operation/key reference and atomically reserve unique reference with debit/order. Recover existing transaction before new work; reject changed body.
- [x] Keep committed replay on cache errors; cache is best effort. Run focused Jest/financial suites.

### Task 2 — F2 adverse funding (independent worker)
Files: payment webhook routing, Paystack provider/service, additive persistence migration if needed, focused tests.
- [x] Reproduce ignored refund/dispute events; test signed inbox routing, independent provider correlation, duplicates/out-of-order/partial/refund/uncertain outcomes.
- [x] Persist exposure/hold and audited operational resolution; never auto-debit negative or silently mark unsupported financial events processed.
- [x] Verify focused tests and real-database fake-provider paths.

### Task 3 — F3 sensitive fingerprints (root)
Files: idempotency interceptor and response crypto service/tests.
- [x] Prove changing PIN does not alter financial business fingerprint; auth secret changes still conflict without unkeyed hashes.
- [x] Exclude transaction PIN from business fingerprints; domain-separated keyed auth fingerprint using server crypto key. Test replay and auth semantics.

### Task 4 — F4/F6 VTU terminal state and escalation
Files: vtu.service/tests; admin reconciliation exception queue/UI if required.
- [x] Reproduce pending/unknown overwriting success and exhausted retries disappearing.
- [x] Guard all transient updates in shared transaction-aware transitions; repair legacy terminal mismatch; persist/emit visible action-required escalation with safe manual recovery.
- [x] Test callback races, terminal outcomes, retries/threshold and no blind refund.

### Task 5 — F5 supervised manual payout handover (independent worker)
Files: manual exchange service/policy/DTO/controller, admin orders UI/service, focused tests.
- [x] Reproduce unavailable claim owner blocking completion.
- [x] Add explicit audited admin handover with outcome verification/reason and owner concurrency guards, no automatic claim expiry or resend.
- [x] Verify DTO/auth/idempotency/concurrency and responsive UI checks.

### Task 6 — F7 exact reconciliation
Files: reconciliation.service and tests.
- [x] Failing tests for +0.01/-0.01 and exact equality.
- [x] Compare exact Decimal nonzero differences; verify regression tests.

### Task 7 — integration verification and operator guide
- [x] Review combined changes against security checklist, no sensitive logs/unsafe financial transitions.
- [x] Run all backend unit tests, isolated PostgreSQL/Redis financial tests, backend/web type checks, full Flutter tests and relevant website checks.
- [x] Record passing counts, remaining live acceptance/deployment requirements, migration and operator instructions. Update audit disposition/security phase notes.

## Final integration evidence

Completed with targeted red/green regressions and independent review follow-up. Final counts: 745 backend, 81 financial, 426 Flutter, 32 desktop/mobile browser cases. Build/types/source lint passed. Migrations 047–051 applied only to isolated test DB. The rollout/operator guide is DOCS/MONEY-FLOW-FIXES-2026-11-02.md. No commit, push, deployment or live money action was performed.
