# Direct-account Exchange Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver both exchange directions to the customer's external beneficiary with admin-recorded payments.

**Architecture:** Extend the existing manual-order delivery policy and server-owned external workflow. Keep historical settlement immutable. Direct exchange has no application amount/daily caps or wallet dependency; customer-row locking serializes duplicate attempts.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Flutter, Next.js and existing Jest/Flutter/Playwright suites.

**Spec:** `DOCS/superpowers/specs/2026-11-04-direct-account-exchange-design.md`

## Global Constraints

- Retain JWT/admin guards, DTO validation, KYC, PIN, idempotency, Decimal arithmetic, evidence privacy, audits and settlement holds.
- No production configuration changes, payment initiation or deployment.
- Reuse the current checkout; preserve its existing unrelated modifications. Leave changes reviewable without committing the owner's shared work.
- Owner update: no direct-exchange per-transaction or daily product limit. Validate only positive two-decimal amounts and exact database representability.

## Review Focus

- Historical WALLET retries must preserve the old destination and exactly-once credit.
- Concurrent new requests must share the same idempotency boundary without needing wallets.
- Paused new creation must leave old funded obligations and original-key recovery accessible.
- A new naira payout cannot bypass exact-amount/evidence requirements through legacy review actions.
- Nigerian forms must never use Ghana account rules or claim automatic name verification.

### Task 1: Backend direct settlement without wallet/product caps

**Files:** `BACKEND/src/exchange/manual-exchange.policy.ts`, `manual-exchange.service.ts`, associated unit tests, `BACKEND/test/manual-exchange.financial.e2e-spec.ts`, `BACKEND/.env.example`.

**Interfaces:** Configuration delivery policy version 2, GHS BANK / NGN MOMO+BANK; `exchangeLimitPolicy:UNLIMITED`; new ADMIN_EXTERNAL workflow and RECORD_PAYOUT_SENT review action.

- [x] Write and run failing direction/configuration tests and real-database reverse bank settlement/large-amount/concurrency cases.
- [x] Remove product caps and implement transactional user lock and duplicate recovery, beneficiary validation and exact-amount external completion without wallet writes.
- [x] Preserve and verify legacy wallet fixture/replay/credit cases.
- [x] Run backend unit, financial integration, strict TypeScript/build and affected lint checks.

### Task 2: Flutter external beneficiaries and authorization

**Files:** `APP/lib/features/exchange/screens/manual_exchange_screen.dart`, `APP/test/manual_exchange_screen_test.dart`, relevant service tests.

**Interfaces:** Consume published receiving options; collect NGN bank details for GHS-source orders. External authorization uses verified KYC and server exchange policy rather than wallet limit gates.

- [x] Write and run failing reverse bank-form, ten-digit validation and Tier 1 wallet-limit-independence regressions.
- [x] Implement source-aware receiving form and external authorization; keep historical wallet recovery.
- [x] Run scoped/full Flutter tests and analysis; capture and inspect phone/desktop/large-text layouts.

### Task 3: Admin payout evidence and operational docs

**Files:** `WEBSITE/src/services/api.ts`, `WEBSITE/src/app/admin/exchange/manual-orders/page.tsx`, `WEBSITE/e2e/admin-manual-exchange.spec.ts`, manual-exchange operational/contract/security docs.

**Interfaces:** Recognize ADMIN_EXTERNAL and RECORD_PAYOUT_SENT, using currency-specific labels, exact payout amount and existing private evidence upload.

- [x] Add and run a failing naira bank-payout admin browser case.
- [x] Implement naira evidence/completion actions while preserving legacy behavior and cedi controls.
- [x] Run scoped desktop/mobile browser checks and web TypeScript/lint.
- [x] Update operating instructions and record verification/remaining activation requirements.
- [x] Request a fresh whole-change review; address important findings and rerun relevant checks.
