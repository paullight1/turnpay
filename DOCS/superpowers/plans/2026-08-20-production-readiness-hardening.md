# TurnPay Production Readiness Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close verified financial-integrity, withdrawal, security, reconciliation, CI-enforcement, and launch-readiness gaps so TurnPay can be evaluated against an explicit real-money production gate.

**Architecture:** Preserve the existing NestJS/Prisma ledger architecture and harden state transitions at the provider-event and payout boundaries. Every economic effect must be idempotent, transactionally guarded, auditable, recoverable, and covered by concurrency/adversarial tests. Release controls then make the verified tests mandatory before `main` changes.

**Tech Stack:** NestJS, TypeScript, Prisma, PostgreSQL, Redis, Jest, Supertest, Next.js, Flutter, GitHub Actions.

**Spec:** `DOCS/SECURITY-RULES.MD`

## Global Constraints

- Follow `AGENTS.md` and `DOCS/SECURITY-RULES.MD` for every change.
- Use `Decimal` for money and Prisma transactions for balance mutations.
- Do not hardcode or log secrets or unmasked account/KYC values.
- Mutation endpoints remain idempotent; provider callbacks remain signature-verified and replay-safe.
- No financial state transition may rely on client-side calculations.
- Add a failing regression test before each behavior change; make it pass before moving to the next task.

---

### Task 1: Atomic virtual-account deposit event claiming

**Files:**
- Modify: `BACKEND/src/banking/banking.service.spec.ts`
- Modify: `BACKEND/src/banking/banking.service.ts`

**Interfaces:**
- Consumes: `ProviderEvent` unique key `(provider, providerReference, eventType)` and the existing `processVirtualAccountDeposit` flow.
- Produces: one atomic event owner per webhook attempt; duplicate `PROCESSING`/`PROCESSED` deliveries create no second economic effect.

- [ ] **Step 1: Write the failing tests** proving a `PROCESSING` event returns a duplicate/in-flight result and that a losing concurrent attempt cannot overwrite a `PROCESSED` event with `FAILED`.
- [ ] **Step 2: Run** `cd BACKEND && npm test -- banking.service.spec.ts --runInBand` and confirm the new tests fail for the expected state-transition reason.
- [ ] **Step 3: Implement an atomic claim** using a conditional `providerEvent.updateMany` transition into `PROCESSING`; only the claimant may process. Guard failure updates with the same ownership/state condition.
- [ ] **Step 4: Re-run** `npm test -- banking.service.spec.ts --runInBand` and then the full backend suite.
- [ ] **Step 5: Verify** the PR workflow passes before Task 2.

### Task 2: Withdrawal state-machine and replay safety

**Files:**
- Modify: `BACKEND/src/payments/payment.service.withdraw.spec.ts`
- Modify: `BACKEND/src/payments/payment.service.ts`
- Modify only if required by discovered gaps: `BACKEND/prisma/schema.prisma` plus a new additive migration.

**Interfaces:**
- Consumes: existing withdrawal transaction, ledger debit/reversal, provider transfer submission and transfer-attempt records.
- Produces: deterministic transitions for request, provider timeout, success, failure, duplicate callback/requery, and reversal.

- [ ] **Step 1: Add adversarial tests** for duplicate idempotency keys, concurrent withdrawals, provider timeout after submission, duplicate success/failure notifications, and replay after success.
- [ ] **Step 2: Run** `npm test -- payment.service.withdraw.spec.ts --runInBand` and confirm any uncovered behavior fails.
- [ ] **Step 3: Implement only the missing guards/transitions** while keeping ledger debit/reversal in ACID transactions.
- [ ] **Step 4: Re-run withdrawal tests and full backend tests.**
- [ ] **Step 5: Verify PR CI before Task 3.**

### Task 3: Financial invariant regression suite

**Files:**
- Create: `BACKEND/src/wallets/financial-invariants.spec.ts`
- Modify only where a failing invariant identifies a production defect.

**Interfaces:**
- Consumes: `LedgerService`, transactions, internal transfers, deposits, withdrawals.
- Produces: executable invariants for non-negative balances, one economic effect per reference/idempotency key, and ledger/balance consistency.

- [ ] **Step 1: Add tests** proving wallet balances never go negative, failed economic operations do not mutate balances, duplicate references do not create duplicate ledger effects, and debit/reversal pairs restore the prior balance.
- [ ] **Step 2: Run** the new invariant suite and confirm failures reflect actual uncovered defects rather than fixture mistakes.
- [ ] **Step 3: Fix any discovered implementation defect with the smallest transactional change.**
- [ ] **Step 4: Run the full backend unit/e2e suite.**

### Task 4: Security-boundary audit and fixes

**Files:**
- Inspect/modify as failures require: `BACKEND/src/auth/**`, `BACKEND/src/admin/**`, `BACKEND/src/payments/webhooks/**`, `BACKEND/src/banking/providers/**`, `BACKEND/src/kyc/**`, `BACKEND/src/main.ts`.
- Add focused `*.spec.ts` regression tests beside each changed component.

**Interfaces:**
- Consumes: JWT/role guards, provider signatures, raw request bodies, DTO validation, PII encryption/masking.
- Produces: protected admin routes, verified webhook trust boundaries, safe logging/error surfaces, and production-only security defaults.

- [ ] **Step 1: Search every mutation/admin/webhook route** for missing idempotency, auth/roles, throttling, signature verification, raw-body handling, unsafe logs, and PII exposure.
- [ ] **Step 2: Write a failing regression test for every verified defect.**
- [ ] **Step 3: Apply the minimum fix and re-run targeted tests.**
- [ ] **Step 4: Run full backend tests and builds.**

### Task 5: Reconciliation and recovery operations

**Files:**
- Modify: `BACKEND/src/common/services/reconciliation.service.spec.ts`
- Modify: `BACKEND/src/common/services/reconciliation.service.ts`
- Modify: `BACKEND/src/app.module.ts` only if scheduling/provider wiring is missing.
- Update operational documentation under `DOCS/PRODUCTION-GUIDES/`.

**Interfaces:**
- Consumes: wallets, ledger entries, transactions, provider events, transfer attempts.
- Produces: deterministic anomaly detection for stuck provider events/transfers, wallet-vs-ledger mismatches, orphan transactions, and retry/recovery candidates without silently mutating financial history.

- [ ] **Step 1: Add failing tests** for stale `PROCESSING` provider events, stale pending withdrawals, orphaned transaction/ledger records, and balance-vs-ledger mismatches.
- [ ] **Step 2: Implement reconciliation queries/reporting and safe recovery classification.**
- [ ] **Step 3: Re-run targeted and full suites.**
- [ ] **Step 4: Document runbook, alert thresholds, and operator actions.**

### Task 6: Release controls and CI enforcement

**Files:**
- Modify: `.github/workflows/ci.yml`
- Add security/dependency workflow files only when they can run without repository secrets.
- Repository settings: protect `main` with required pull-request/status-check controls where supported by the GitHub integration.

**Interfaces:**
- Consumes: backend tests/e2e/build, website lint/build/e2e, Flutter analyze/tests.
- Produces: a mandatory release gate with no direct unreviewed push to `main` and no Docker publish unless validation passes.

- [ ] **Step 1: Verify current workflow status and job names on this PR.**
- [ ] **Step 2: Add migration-safety and secret/dependency scanning gates where missing and test the workflow on the PR.**
- [ ] **Step 3: Enable `main` branch protection requiring PRs and the verified check contexts where the connector supports it.**
- [ ] **Step 4: Confirm a passing PR cannot be confused with a production provider readiness claim.**

### Task 7: Production launch audit and evidence

**Files:**
- Update: `DOCS/CODEBASE-STATUS-REVIEW.MD`
- Update: `DOCS/TASKS.MD`
- Create: `DOCS/PRODUCTION-READINESS-2026-08-20.md`

**Interfaces:**
- Consumes: all implemented code, tests, CI checks, deployment/config evidence and external provider/compliance prerequisites.
- Produces: an evidence-based GO/NO-GO checklist separating code-complete items from external credentials, KYB/licensing, production webhooks, settlements, backups and live-provider validation.

- [ ] **Step 1: Re-audit changed files and unresolved launch blockers.**
- [ ] **Step 2: Run/verify all available CI and record exact check results.**
- [ ] **Step 3: Classify every remaining blocker as code, configuration, provider/compliance, or live-production evidence.**
- [ ] **Step 4: Mark the product production-ready only if all code gates pass and no unresolved P0/P1 software defect remains; external launch blockers must remain explicitly gated rather than falsely claimed complete.**
