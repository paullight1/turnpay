# BVN-first KYC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver the approved BVN-first Tier 1 journey, NIN Tier 2 upgrade and consistent money-action eligibility on web/mobile.

**Architecture:** Keep Paystack BVN and account preparation asynchronous. Route NIN to a separately configured Ninja adapter; retain existing manual reviews. Enforce configured Tier 1 limits at the common ledger boundary and direct external exchange order boundary, using locked wallet rows and existing persisted ledger/order records for shared usage; clients explain server-owned eligibility.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Next.js/shadcn/TanStack Query, Flutter.

**Spec:** DOCS/superpowers/specs/2026-11-02-bvn-first-kyc-design.md (approved by owner).

## Global Constraints

- All supported transactions are eligible at Tier 1 within configured limits; no numeric production caps are invented.
- Pending NIN does not remove earned Tier 1. No bulk historical downgrade.
- No live activation, identity decisions, production limit changes, deployment or real-money testing.
- Preserve all pre-existing checkout edits. Reuse this active feature branch and installed dependencies.
- Follow DOCS/SECURITY-RULES.MD; preserve idempotency, transaction PINs, holds, Decimal accounting and provider signatures.

## Review Focus

- Missing/malformed Tier 1 policy must fail closed without restricting compensating refunds.
- Parallel different action types must serialize shared daily consumption; incoming credits cannot exceed configured wallet balance.
- NIN pending/failure must never turn a verified BVN customer into unverified.
- Legacy NIN-only users retain earned tiers but do not bypass Paystack account validation.
- Provider request acceptance/malformed success must not earn an identity tier.

### Task 1: Tier policy and monetary boundaries

Files: new BACKEND/src/common/services/tier-one-limits.service.ts and spec; BACKEND/src/wallets/{ledger.service.ts,wallets.module.ts}; current payment/transfer/VTU/exchange eligibility and tests.

Interfaces: TierOneLimitsService.checkMovement(tx, input, direction) and checkExternalExchange(tx, input) consume current Prisma transaction, authenticated user, Decimal amount/currency/reference; expose configured safe policy summary. Tier 2 retains existing action limits; missing Tier 1 policy returns a stable code.

- [x] Add failing tests for Tier 1 missing policy, per-action/daily/balance caps, mixed ledger/external usage, compensation and Tier 2 behavior; run focused Jest.
- [x] Implement shared policy checks with locked wallet row, current user state, existing ledger/order aggregation and no schema migration. Use existing terminal failure/reversal semantics to release failed usage.
- [x] Change minimum action tier and capabilities to Tier 1; retain suspension/provider/feature checks and existing tighter action caps.
- [x] Run focused Jest and backend build; record results without committing unrelated work.

### Task 2: BVN-first tier promotion and Ninja NIN

Files: BACKEND/src/kyc/{kyc.service.ts,kyc.module.ts}, providers/ninja.provider.ts and tests; configuration and .env.example.

Interfaces: existing POST /kyc/verify chooses Paystack for BVN and readiness-gated Ninja for NIN. GET /kyc/status adds NIN readiness and safe configured Tier 1 limits; existing fields remain compatible.

- [x] Add failing provider tests for complete field matches, mismatches, malformed/transport responses and sanitized evidence; tier tests for BVN-only, NIN-only and both.
- [x] Implement current documented Ninja verify mode with server-only key, allowlisted HTTPS host, fixed reference and no redirects. Require verified BVN and named consent for new NIN attempts.
- [x] Preserve existing manual-review attempts and recovery; prevent NIN rejection/pending from removing Tier 1.
- [x] Run KYC/controller/provider/configuration tests and build.

### Task 3: Minimal web KYC and action gates

Files: WEBSITE/src/app/dashboard/kyc/page.tsx; new components/kyc/tier-progress.tsx; lib/account-status.ts; types/services; money-action entry points; e2e/kyc.spec.ts.

Interfaces: compatible overview with ninVerificationAvailable and tierOneLimits; one primary BVN section and quiet NIN upgrade; shared gate wording derives from authoritative tier/status.

- [x] Replace obsolete Monnify-first browser expectations with failing BVN-first/Tier 1/pending-NIN cases; run desktop and phone browser cases.
- [x] Implement restrained tier overview, focused forms, separate bank preparation status and state-specific gate CTAs; refresh profile/status after outcomes. Keep private manual evidence fallback.
- [x] Verify desktop/phone layouts, validation, pending and completed states with screenshots, scoped lint and TypeScript.

### Task 4: Matching Flutter journey and gates

Files: APP/lib/services/{home_data_service.dart,kyc_service.dart}; features/home/widgets/kyc_status_{presenter,widgets}.dart; KYC/home/account/money-action screens; manual exchange gate; related widget/policy tests.

Interfaces: same server status/readiness and tier semantics as web; keep route/gate method compatibility while migrating messages and minimum tiers.

- [x] Add failing Tier 1 transaction access, pending-NIN, BVN-first overview and NIN readiness tests; run focused Flutter tests.
- [x] Implement compact primary Tier 1/secondary Tier 2 rows, explicit bank status and consistent Verify BVN / View status / Upgrade actions across entry points.
- [x] Preserve personal-details preflight, evidence preview and recovery; wire automated NIN only when backend reports ready.
- [x] Run focused widget tests and Flutter analysis.

### Task 5: Integration verification, review and delivery

- [x] Run relevant backend suites, web browser scenarios and Flutter regressions; investigate failures before expanding checks.
- [x] Have a fresh reviewer inspect the task's diff against the approved spec; fix important findings and rerun affected checks.
- [x] Update KYC/provider/activation documentation and security phase note with tested behavior and activation/configuration limits.
- [x] Provide screenshots and a concise report distinguishing implemented local behavior from live readiness.

## Execution ledger

Ruling: Execute natively following the owner's explicit “Approve and implement”; do not introduce another plan approval.
Ruling: Reuse paul/paystack-bvn-recovery and its working files; creating a clean worktree would omit necessary current fixes. Do not create commits that capture another task's work.
Ruling: Reuse existing ledger and manual order records for Tier 1 usage rather than introducing a second financial reservation model. Serialize checks inside the same financial transaction. Aggregate gross covered spending; existing failed/reversed transactions release usage. Exact refunds remain governed by original accounting state machines.

Verification: backend 764 unit tests, 85 local PostgreSQL/Redis financial tests, 20 desktop/mobile browser cases and 100 Flutter tests passed. Build, scoped lint, TypeScript and Flutter analysis passed. See DOCS/BVN-FIRST-KYC-VERIFICATION-2026-11-02.md.
Ruling: Preserve Tier 2 external paid exchange without requiring a source wallet; the Tier 1 shared-budget check alone needs the locked wallet. Reproduced with a failing regression before fixing.
Ruling: Keep existing KYC primitives rather than adding an unused tier-progress component. Exclude generated Playwright reports from source scanning to prevent a verified HMR startup loop.
