# Paystack Migration Implementation Plan

> **For agentic workers:** Use executing-plans for backend orchestration and dispatching-parallel-agents for disjoint KYC and client surfaces. The user explicitly requested execution of the improved design.

**Goal:** Make new Nigerian payment and onboarding flows use Paystack across backend, website, admin and Flutter.
**Architecture:** A shared Paystack HTTP client owns authentication and customer bindings. A banking adapter translates Paystack into the existing ledger/payment interfaces. Durable KYC and account state drive signed webhooks and client recovery; historical Monnify records retain their provider identity.
**Tech Stack:** NestJS, Prisma/PostgreSQL, Next.js, Flutter.
**Spec:** `DOCS/superpowers/specs/2026-10-30-paystack-migration-design.md`

## Global Constraints

Preserve existing dirty working-tree changes. No live credentials in clients/logs. Decimal money, atomic ledger changes, idempotent mutations, JWT/role guards, signature verification. BVN grants Tier 1; independently reviewed NIN plus BVN grants Tier 2. VTpass stays unchanged. No production database mutations or live money tests.

## Review Focus

- Timeout followed by webhook must never credit/refund twice.
- Delayed identity success must not approve another submission.
- Bank resolution must be available before KYC so onboarding is possible.
- Provider transfer OTP belongs to the merchant, not the customer.
- Legacy account/provider data must remain reconcilable after default changes.

## Task 1: Provider and persistence contracts

Files: `BACKEND/src/paystack/*`, `BACKEND/src/banking/providers/paystack-virtual-account.provider.ts`, `BACKEND/prisma/schema.prisma`, additive migration.
Produces: `PaystackClient.request<T>(method, path, data?, params?)`, `ensureCustomer(userId)` returning `{customerCode, customerId}`; `PaystackVirtualAccountProvider` matching existing bank/transfer adapter methods. Persistence: `PaystackCustomer` unique userId/customerCode, validationStatus; `PaystackAccountRequest` unique userId, customerCode, status, attempts, nextAttemptAt, claimedAt, lastError, consentRecordedAt. Add PAYSTACK KYC enum and composite webhook-log identity.

- [x] Write adapter tests for exact minor units, pending status, unavailable keys and verification mismatches; run red.
- [x] Implement shared client, adapter and additive migration; run Prisma generate and focused tests green.

## Task 2: KYC and account preparation

Files: `BACKEND/src/kyc/*`, provider gateway and manual document DTOs.
Consumes Task 1 client and schema. Produces `KycService.processPaystackIdentification(eventType, data)` and `POST /api/kyc/manual-documents`. Existing `POST /api/kyc/verify` accepts BVN plus `bankCode`, `accountNumber`, consent and legal name; returns PENDING until authenticated provider evidence. Account setup requested after verification only with explicit consent.

- [x] Test pending identity, duplicate in-flight submission, stale callbacks, manual document ownership and no unearned tier promotion; run red.
- [x] Implement serialized persistence and callback handling; register manual submissions with secure storage checks and audited review.
- [x] Run KYC tests green and check existing Monnify fixtures remain valid.

## Task 3: Payments, banking and signed recovery

Files: banking services/module, payments service/controller/module, webhook controller/processor/DTO, new checkout service.
Produces `GET /api/payments/capabilities`, `POST /api/payments/initialize` with amount/currency/idempotency, `GET /api/payments/verify/:reference`, `POST /api/webhooks/paystack`. Existing bank/beneficiary/withdraw endpoints default Paystack. Bank list and resolution must be authenticated but usable before KYC. Funding verification returns reference/status; initialize returns reference/authorizationUrl. Virtual account requests return real account data or HTTP 202 pending state.

- [x] Test signed ingestion, wrong-owner funding, duplicate credit, exact amount verification, legacy routing and merchant OTP rejection; run red.
- [x] Implement API contracts, account request recovery and verified event normalization using existing ledger and allocation transaction boundaries.
- [x] Keep Monnify processing only for existing records, route reconciliation by stored attempt provider, and gate unsupported new exchange paths.
- [x] Run banking/payment/webhook/reconciliation suites green.

## Task 4: Website, admin and Flutter

Files: `WEBSITE/src/services/api.ts`, types, dashboard KYC/fund/withdraw, admin KYC; `APP/lib/services`, onboarding and wallet/payment screens and tests.
Consumes Tasks 2–3 contracts. No client chooses providers or receives merchant keys. KYC uses BVN+bank details and manual NIN upload flow; funding offers DVA and hosted checkout with server verification on return; pending states recover through polling/status refresh. Existing account history remains readable.

- [x] Update client flow fixtures for new inputs, pending account state, checkout return and legacy account history; unavailable runtime checks are recorded below.
- [x] Implement both clients against contracts; preserve visual system and existing uncommitted UI work.
- [x] Run website typecheck, focused lint, production build and desktop/mobile admin visual checks.
- [x] Run Flutter analyze/tests: follow-up configured Flutter 3.44.6, passed 290 tests with no analyzer issues, and passed release-mode web compilation. Customer dashboard visual checks remain blocked by the existing intentional `/download` redirect.

## Task 5: Configuration, integration and review

Files: `app.module.ts`, readiness, environment examples, manifests/scripts, provider source of truth, AGENTS and activation guide.

- [x] Replace new-deployment Monnify credential requirements with Paystack live-key validation and explicit per-feature gates.
- [x] Update secret scanning, callbacks, documentation and activation instructions; retain explicit legacy drain controls.
- [x] Run backend full suite/build/lint, Prisma validation and frontend checks; inspect changes with a fresh reviewer and fix material findings. Record the unavailable mobile checks separately.
- [x] Report actual checks and remaining live activation requirements. Do not claim live functionality without an authorized acceptance test.

## Execution ledger

- Baseline: 5 focused suites / 47 tests passed before implementation.
- Ruling: reuse the current `website` branch and dirty checkout because it contains active payment/KYC UI work; preserve user edits rather than cloning an incomplete committed baseline.
- Ruling: user instructed critique and execution, so no further design/plan approval gate applies.

- Ruling: new external FX deposits fund the NGN wallet through Paystack before using the existing exchange flow. Do not automatically classify ambiguous DVA transfers as FX receipts; this avoids double allocation and unapproved cross-border settlement. Legacy exchange intent reconciliation remains.
- Review correction: use `fund-<digest>` checkout references and `wd-<UUID>` transfer references; enforce the documented NGN 50 checkout minimum and 16–50 character transfer range. Regression tests demonstrated the previous formats were invalid.
- Review correction: definite pre-acceptance provider rejections atomically refund reserved withdrawals; transport ambiguity stays pending. The independently verified late-success correction for incoming checkout funding is documented in the activation guide and covered by financial tests.
- Verification checkpoint: backend full suite passed 78 suites / 553 tests before the final review corrections. New correction tests were observed failing, then passed in the focused payment suites. Final whole-suite verification remains required after all review changes.
- Final backend verification: 78 suites / 570 tests passed after all review corrections and customer-creation recovery; Nest build, backend ESLint, Prisma validation, deployment-manifest checks and shell syntax checks passed. Website typecheck, focused ESLint and production build passed. Flutter/Dart SDK is unavailable, so Flutter analyze/tests could not run. No live credentials or real money were used, and no deployment or database migration was applied.

- Final client verification: website production build/typecheck/focused lint passed; four authenticated local Playwright checks passed across desktop/mobile. Automated Paystack admin KYC controls are read-only. Customer web routes intentionally redirect to `/download`, so their checkout/KYC visual rendering was not verified. Flutter fixtures were migrated, but Flutter compilation and widget tests remain unrun without the SDK.


## Follow-up verification — 30 October 2026

The SDK limitations recorded above are historical and are superseded by [the follow-up report](../../PAYSTACK-VERIFICATION-2026-10-30.md). Flutter 3.44.6 is configured; the final app suite passes 290 tests, the analyzer has no issues, and release-mode web compilation passes. Backend verification passes 79 suites / 582 tests plus build/lint; schema and manifest checks pass. Checkout now has durable account-scoped restart recovery, a copyable reference and actionable unresolved-payment guidance. Local live-key read-only connectivity is confirmed. Migration 041 remains the only unapplied database migration; local Redis, idempotency encryption and Supabase service-role settings still require production configuration. No deployment, database mutation or live payment was performed.
