# Manual-exchange-first mobile production readiness implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task in this task. Steps use checkbox tracking. Do not start parallel agents by default.

**Goal:** Launch a simple manual Exchange product: external deposit, receipt submission, admin confirmation, and either automatic TrustPay wallet credit or payout to the customer’s bank/MoMo account. Initial corridor assumption is NGN→GHS; unattended approval, automatic external settlement and additional corridors are deferred.

**Architecture:** Preserve the existing app/backend. Extend protected receipt storage and admin tooling with one externally funded exchange-order flow. Keep deposit confirmation separate from payout completion; reuse wallet-credit approval only for WALLET mode; BANK/MOMO must not trigger a wallet credit or an unfunded wallet debit. Reuse financial recovery, audit, reconciliation and release tooling.

**Tech stack:** Flutter/Riverpod/Dio; NestJS/Prisma/PostgreSQL/Redis; Monnify; Ninja; VTpass. No additional payment provider.

**Spec:** [Approved launch design](../specs/2026-09-05-simple-mobile-launch-design.md).

**Baseline:** Review on 5 September 2026: 64/100, clean analyzer, 138 passing Flutter tests. These results belong to the reviewed working copy, which contains uncommitted changes. HEAD observed during planning: `75e5f17`. Native builds, live integrations and operational certification remain unverified. This plan does not upgrade that score.

## Implementation checkpoint — 5 September 2026

Local delivery is recorded in [the implementation evidence](../../implementation/2026-09-05-mobile-delivery-status.md). Tasks 1–7 and 9 have code and automated coverage; their staging, physical-device and operational acceptance remains open. Checked steps below mean the described local work is complete, not that a launch gate is VERIFIED. Mixed implementation/device steps remain unchecked until all their acceptance is met.

The implemented pin contract uses SHA-256 of the leaf certificate DER, **not SPKI**. Both API and refresh Dio clients enforce it alongside normal TLS. Supabase SDK traffic and external links are separate transports. Collection configuration is server-managed; settlement mode is immutable. Payout claims do not expire or auto-reassign: uncertainty goes to reconciliation/support. No automatic external transfer or live activation was added.

## Global constraints

All constraints in the spec apply. Work sequentially in small reviewable changes. Run targeted tests first, then relevant project checks. Do not rewrite the whole money screen. Do not store credentials in this plan or evidence. No production database resets or test-fixture cleanup against live accounts.

## Delivery order

| Stage | Tasks | Deliverable | Exit condition |
| --- | --- | --- | --- |
| 1 — Working manual Exchange | 1–3 | Collection instructions, receipt upload, admin confirmation/payout and persistent customer status | End-to-end manual exchange plus UI/security tests pass |
| 2 — Safe money and sessions | 4–6 | Durable recovery, financial certification coverage, native security | No unresolved high-risk money/security defect |
| 3 — Installable and supported | 7–9 | Signed staging artifacts, device evidence, support/monitoring | Device and staging acceptance matrix passes |
| 4 — Controlled launch | 10 | Approved release candidate and small pilot | Operational evidence and required approvals complete |

Start with Task 1. Do not start expansion work to improve the apparent score. A disabled feature is recorded as excluded; the original full-product score and the scoped launch assessment stay distinct.

## Task 1 — Build the manual Exchange flow first

**Files:** Create `APP/lib/services/manual_exchange_service.dart`, focused views under `APP/lib/features/exchange/`, `APP/test/manual_exchange_flow_test.dart` and `APP/integration_test/manual_exchange_flow_test.dart`. Modify `APP/lib/core/router/app_router.dart`, home Exchange entry points, `BACKEND/src/exchange/exchange.controller.ts`, `exchange.service.ts`, `dto/exchange.dto.ts`, `BACKEND/prisma/schema.prisma` and a reviewed Prisma migration. Reuse `WEBSITE/src/app/admin/page.tsx`, `WEBSITE/src/services/api.ts` and protected upload infrastructure. Read WEBSITE/AGENTS.md before changing the admin application.

**Existing behavior to preserve:** `/api/exchange/receipts` currently creates an NGN→GHS wallet-credit receipt. `/api/exchange/payouts` currently debits the NGN wallet. The new externally funded WALLET mode reuses the guarded receipt-credit semantics. BANK/MOMO mode must not execute the wallet credit or wallet-funded debit. A single deposit cannot be consumed by both paths. Existing orders retain their existing semantics.

**Proposed new contract:** `/api/exchange/manual-orders` creates an authenticated, idempotent order with source amount, settlement mode `WALLET|BANK|MOMO`. WALLET targets the authenticated customer’s destination-currency wallet; BANK/MOMO require institution/provider, account/phone and beneficiary name. Bind the customer-confirmed mode to the order. The server returns order ID/reference, frozen rate/fees/receive amount, expiry and collection instructions. `GET /api/exchange/manual-orders/:id` returns the owner's order. `POST /api/exchange/manual-orders/:id/proof` attaches a managed object key and transfer reference. Admin actions under `/api/admin/exchange/manual-orders/:id/` are explicit `approve-and-credit` (WALLET only), `confirm-deposit` (BANK/MOMO), `request-information`, `reject`, `claim-payout`, `mark-sent`, and `complete`; no arbitrary status PATCH. Reuse upload signing after verifying owner/order association and actual object validation. Add a narrow proof-replacement action for information requests that retains previous proof versions.

```text
AWAITING_TRANSFER --proof accepted--> AWAITING_CONFIRMATION
AWAITING_CONFIRMATION --WALLET: admin verifies inflow; atomic ledger credit--> CREDITED
AWAITING_CONFIRMATION --BANK/MOMO: admin verifies actual inflow--> PAYOUT_PENDING
AWAITING_CONFIRMATION --admin reason--> NEEDS_MORE_INFO / REJECTED
NEEDS_MORE_INFO --customer adds proof--> AWAITING_CONFIRMATION
PAYOUT_PENDING --operator claims--> PAYOUT_PROCESSING
PAYOUT_PROCESSING --external payment evidence--> PAYOUT_SENT
PAYOUT_SENT --settlement evidence--> COMPLETED
```

Internal state names are a proposed order contract, not existing enum values. Display “Awaiting confirmation” immediately after the server accepts proof, never merely after local file selection. If payment evidence proves settlement at submission, an explicit atomic mark-sent-and-complete operation may record both events. Otherwise keep “Payout sent” separate from completed.

- [x] **1a — Persistent order and instructions.** Add failing backend tests for an owner-scoped order, stable replay, exact rate snapshot and no wallet balance change. Implement the minimal order/DTO/migration/service and admin-managed collection configuration. Snapshot collection-account version, rate, fees, expiry and beneficiary before showing transfer instructions. Existing configured accounts can be reused only when reconciliation can distinguish exchange deposits from wallet funding.
- [ ] **1b — Receipt upload and customer tracking.** Add a Flutter test that receives a real server order ID, uploads a valid proof, submits once, recreates the screen and sees “Awaiting confirmation” from the API. Implement gallery/file selection, upload progress/retry, object ownership, server-side type/size checks using existing limits, and private signed reads. No API bearer token may be sent to the storage host. Lost upload/submission responses reuse the existing order and attempt key.
- [ ] **1c — Admin verification.** Extend the existing admin queue to show order reference, expected/received amounts, receipt, deposit evidence and beneficiary. Implement guarded, idempotent confirmation/information/rejection actions, recording actor, reason and before/after state. Confirm the actual incoming bank/Monnify settlement independently of the screenshot. Match a bank/provider reference to only one obligation, including normal wallet funding paths.
- [ ] **1d-wallet — Automatic credit after admin approval.** Reuse `LedgerService.creditWallet` and the receipt-credit transaction for WALLET mode, binding one order/deposit reference to one credit. Set CREDITED and its ledger reference in the same transaction as the exact destination-currency credit and audit event. A failed transaction leaves both status and balance unchanged. Replay returns the original outcome; concurrent admins cannot double-credit. Reject external payout actions on a credited order. Refresh the customer balance and show Credited from server state; do not optimistically add money.
- [ ] **1d — External payout.** Record deposit allocation and outstanding payout obligation transactionally without a spendable wallet credit. Add operator claim/lease with explicit recovery after uncertain submission; another admin cannot independently pay an already claimed/sent order. Operator sends through the approved external bank/MoMo process, then stores actual payout reference and private proof. A timeout or ambiguous external result requires reconciliation, never an automatic second send. Software cannot stop a separate manual payment outside this workflow; the operating procedure must enforce reference checks and existing dual control.
- [x] **1e — Customer status and exceptions.** Poll only while viewing the active order; also refresh on resume and pull-to-refresh. Display admin notes and request-more-information controls. No push infrastructure. Expired instructions, mismatched amounts or changed terms remain reviewable; do not silently reprice. After confirmed incoming funds, cancellation/rejection requires a tracked refund/settlement case and cannot erase the obligation.
- [ ] **1f — Financial evidence.** Test duplicate proof submission, one deposit reused by two orders, two concurrent admin confirmations, competing payout claims, premature completion, cross-user proof access, customer attempts to act as admin and rejected/late deposits. Assert exactly one allocation and zero unintended wallet credits/debits; WALLET credits exactly once, while BANK/MOMO credit zero times. Test races between approve-and-credit and claim-payout, and require an audited customer-confirmed change before any pre-settlement mode switch. Extend the real financial E2E Jest configuration so the new manual-order test is actually included.
- [ ] **1g — Stage the whole journey.** Run the backend manual-order tests and `flutter test test/manual_exchange_flow_test.dart`; execute the admin/customer journey against staging and verify the same order/reference and state on both sides. Review the migration and record the evidence. Keep production activation off until Tasks 5–10 are verified.

**Illustrative backend assertions for the new flow:**

```text
After proof submission: order.state == AWAITING_CONFIRMATION; walletDelta == 0
After duplicate BANK/MOMO confirmation: incomingAllocations == 1; payoutObligations == 1
After duplicate WALLET approval: walletCredits == 1; externalPayouts == 0
After bank/MoMo payout: walletCredits == 0; externalPayouts == 1
After failed WALLET transaction: walletDelta == 0; order is not CREDITED
Before deposit confirmation: claim-payout returns conflict; outgoingAllocations == 0
After two payout claims: exactly one owner; other claim returns conflict
After completed payout retry: outgoingAllocations == 1; completionReference unchanged
```

**Scope:** Exchange is the first home action. Keep admin-triggered wallet credit and bank/MoMo payouts for the initial corridor; defer unattended exchange and unrelated corridors. Secondary wallet/VTU features may remain disabled until independently certified. Existing user balances/history remain accessible. This task resolves the incomplete Exchange finding instead of hiding it.

## Task 2 — Fix Android biometrics and define app privacy

**Files:** Modify `APP/android/app/src/main/kotlin/com/trustpay/app/MainActivity.kt`, Android day/night styles if required by the installed plugin, `APP/lib/core/widgets/app_lock_gate.dart`, `APP/lib/services/transaction_security_service.dart`, and `APP/ios/Runner/SceneDelegate.swift`. Extend `APP/test/app_lock_gate_test.dart`; create `APP/integration_test/native_security_test.dart`.

**Minimal Android change:** Keep the existing secure-window flag while replacing the activity base:

```kotlin
import io.flutter.embedding.android.FlutterFragmentActivity
class MainActivity : FlutterFragmentActivity() {
    // Retain the existing onCreate implementation and FLAG_SECURE.
}
```

- [ ] Verify requirements in the installed `local_auth_android` README, including launch theme compatibility, and apply the minimal native setup. Do not duplicate permissions blindly; inspect the merged manifest.
- [x] Define and test: lock before protected content on resume/cold start; establish device PIN binding from successful server verification; no lock loop during biometric prompts; logout remains available when secure storage fails.
- [x] Implement 15-minute foreground inactivity expiry using an injectable clock/activity signal. Explicit logout clears tokens; network interruption alone does not. An unresolved payment journal survives logout under its original account and is inaccessible to another account.
- [x] Cover first login without local PIN, biometric cancellation/failure, unavailable hardware, wrong PIN/lockout, storage failure and session revocation. Do not unlock because an exception occurred.
- [x] Add an opaque iOS scene privacy cover while inactive/backgrounded, removing it only after active lock state is established. Preserve Android screenshot protection.
- [ ] Run `flutter test test/app_lock_gate_test.dart test/transaction_security_service_test.dart`. On staging devices, run `flutter test integration_test/native_security_test.dart -d DEVICE_ID`; select the actual ID using `flutter devices`.
- [ ] Save Android/iOS recordings of lock/resume and biometric fallback with synthetic data. Device-only checks stay unverified until exercised.

## Task 3 — Make financial presentation exact and failures honest

**Files:** Create `APP/lib/core/money/money_value.dart`, `APP/lib/core/state/resource_state.dart`, `APP/test/money_value_test.dart`, and `APP/test/financial_data_state_test.dart`. Modify `APP/lib/services/wallet_service.dart`, `home_data_service.dart`, and affected wallet/history/analytics/receipt views.

**Contract:** `MoneyValue.parse(String)` accepts a signed decimal string with at most two fractional digits, stores `BigInt` minor units, and exposes `decimalString`. Amount input separately requires positive values. Resource states distinguish loading, value, empty, unavailable and stale; auth rejection remains an auth event.

```dart
test('keeps exact minor units and rejects malformed money', () {
  expect(MoneyValue.parse('9999999999999.99').decimalString,
      '9999999999999.99');
  expect(MoneyValue.parse('0.10').decimalString, '0.10');
  expect(() => MoneyValue.parse('not-money'), throwsFormatException);
  expect(() => MoneyValue.parse('1.001'), throwsFormatException);
});
```

- [ ] Add the tests above before implementing exact parsing/formatting. Extend for zero, signed ledger amounts and currency mismatch; retain string-based request amounts.
- [ ] Replace money `double` conversions and silent zero defaults in touched models. Chart coordinates may use derived doubles, but labels, totals, receipts and business decisions use exact values.
- [x] Replace broad error-to-empty handling: a 503 shows unavailable/retry, an actual empty 200 shows empty, and malformed financial data shows an error. Display last refresh time for any retained stale data; never approve spending from cached balance alone.
- [x] Add widget tests proving a transaction-fetch 503 does not display “No transactions yet”, and a real empty response does.
- [ ] Run the new tests plus `flutter test test/wallet_detail_screen_test.dart test/analytics_screen_test.dart test/home_screen_test.dart`. Review receipts against exact server strings.

## Task 4 — Recover payment attempts across restarts

**Files:** Create `APP/lib/services/payment_attempt_store.dart`, `payment_recovery_service.dart`, and `APP/test/payment_recovery_test.dart`. Modify `APP/lib/services/api_client.dart`, money submission/withdrawal authorization screens and authenticated bootstrap. Extend `APP/test/support/trustpay_test_api.dart` and internal-transfer/VTU integration coverage. Inspect `BACKEND/src/transfers/internal-transfer-idempotency.service.ts`, generic idempotency storage, payment and VTU status services before adding an endpoint.

**Proposed client contract:** `PaymentAttemptStore.prepare(userId, operation, canonicalPayload)` persists an attempt before transport and returns its stable key. `loadUnresolved(userId)` restores only that account's attempts. `recordServerState(userId, key, reference, state)` records authoritative outcomes. All methods are asynchronous and writes are serialized. Canonical payload excludes PIN/OTP/auth tokens, retains exact amounts, and is encrypted with secure storage. Resolve stable recipient/beneficiary identity where the endpoint supports it.

```text
PREPARED -> SUBMITTED -> UNKNOWN or PENDING or SUCCESS or FAILED
UNKNOWN/PENDING -> server-confirmed SUCCESS, FAILED, or REVERSED
Transport failure, a 404, and an expired idempotency record are NOT proof of failure.
```

- [ ] Write a failing integration test: the mock server commits once then drops its response; dispose the screen, recreate services from the same secure storage, restore the attempt, and resolve to the original reference. Assert server debit count is one.
- [x] Implement the journal and account-scoped restoration. If persistence fails, prevent submission. Store no PIN; require fresh server authorization before any explicit resend.
- [x] Make unknown/pending state visible and prevent an accidental replacement attempt. Never automatically resend on startup. Separate a deliberately new payment from a retry of an existing one.
- [ ] Use `/api/exchange/manual-orders/:id` for the new Exchange order and preserve its specific deposit/payout states during recovery. Reuse `/api/transfers/internal/:reference`, `/api/payments/withdrawals/:reference`, and `/api/vtu/orders/:reference` for secondary services.
- [x] For lost responses without a reference, add a small authenticated resolver only if existing APIs cannot resolve the original key. Proposed route: `POST /api/payment-attempts/resolve`; DTO `{operation, attemptKey}`; response `{state, reference?}` with state `UNKNOWN|PENDING|SUCCESS|FAILED|REVERSED`. Scope every lookup to authenticated user, rate-limit, redact the key/body, use a distinct request idempotency key and never cause a financial mutation. Missing/expired records return UNKNOWN. Add it under `BACKEND/src/payment-attempts/` and register in `BACKEND/src/app.module.ts` only if needed.
- [ ] Test another user's attempt lookup, modified-payload conflict, simultaneous duplicate taps, crash before transport, crash after commit, pending VTU, logout/relogin and corrupted storage. Unknown remains recoverable or escalates to support; it does not become a new payment automatically.
- [ ] Run `flutter test test/payment_recovery_test.dart test/internal_transfer_flow_integration_test.dart test/vtu_money_action_flow_test.dart` and the targeted backend resolver/idempotency tests. Record G04 only after a real staging lost-response/restart test also passes.

## Task 5 — Verify backend safety for Exchange and every secondary enabled service

**Files:** Reuse `BACKEND/test/internal-transfer.financial.e2e-spec.ts`, `banking-webhook.financial.e2e-spec.ts`, `vtpass-vtu.financial.e2e-spec.ts`, payment withdrawal tests, `BACKEND/src/common/services/reconciliation.service.spec.ts`, and `DOCS/PRODUCTION-GUIDES/20-INTERNAL-TRANSFER-CERTIFICATION.md`.

- [x] Run existing financial E2E against a disposable test database; inspect `BACKEND/test/support/transfer-fixtures.ts` for required environment safeguards first. Command from `BACKEND`: `npm run test:financial:e2e`.
- [ ] Include externally funded manual Exchange and verify settlement is exclusive: WALLET credits the correct currency once; BANK/MOMO does not also credit an NGN/GHS wallet. Reconcile collection, outstanding payout/refund obligations and external settlement.
- [ ] Fill uncovered cases: duplicate/late/out-of-order provider notifications, amount mismatch, insufficient funds, concurrent debits, rejection, timeout, reversal and OTP expiry. Assert exact wallet deltas and ledger entries, not only HTTP 200.
- [ ] Verify actual DTOs, JWT/ownership guards, rate limits, PIN checks, shared idempotency and audit events on all enabled mutations. Do not assume the Flutter header means server deduplication works.
- [ ] Map transaction/PIN/KYC eligibility and public error responses consistently. Verify Ninja's resulting tier can reach only the approved services; report unavailable upgrade paths to the product owner.
- [ ] Run `npm run lint`, `npm test -- --runInBand`, and `npm run build` after fixes. Execute the managed-Redis and multi-instance cases already required by transfer certification in staging.
- [ ] Attach evidence to the existing transfer register. This task does not approve production enablement or replace its named approvals.

## Task 6 — Wire transport pinning and device integrity

**Files:** Replace placeholder wiring in `APP/lib/services/platform_security_service.dart`; create a centralized `APP/lib/services/secure_transport_factory.dart`; use it in both main and refresh Dio clients. Native implementations live alongside Android `MainActivity.kt` and iOS `Runner` security code. Extend `APP/test/platform_security_service_test.dart` and device integration tests.

- [ ] Inventory every app connection before implementation: API, refresh, SDK auth connection if used, and external legal/support links. Define the controlled first-party hosts and document separate SDK transport treatment; do not claim all traffic is pinned when only one Dio client is.
- [ ] Obtain current and independently managed backup leaf-certificate DER SHA-256 pins from the operator-controlled TLS configuration. Implement normal certificate/hostname validation plus pin matching using a maintained compatible adapter/native transport. Never use a permissive bad-certificate callback as pinning.
- [x] Centralize creation so refresh requests cannot bypass the policy. Release builds reject missing controlled-host pin configuration; debug exceptions must not compile into production policy.
- [x] Implement real root/jailbreak signals with explicit trusted/risky/unavailable results and a documented restriction policy. Risky/unavailable results cannot silently grant approval. Preserve read-only access and support; sensitive actions use the required PIN/server controls and, where configured, verified platform evidence rather than a trusted client boolean.
- [ ] Test matching pin, wrong pin, backup pin, certificate rotation, offline failure, refresh traffic, rooted/jailbroken or simulated risky result and unavailable integrity service. Keep simulator results distinct from physical-device evidence.
- [x] Document recovery from certificate rotation without disabling TLS verification. Pin/integrity operator prerequisites remain G06 blockers until supplied and verified.

## Task 7 — Produce reproducible signed builds

**Files:** Add `.github/workflows/mobile-release.yml`, `scripts/check-mobile-release-config.sh` and its tests; modify `APP/lib/main.dart`, `APP/android/app/build.gradle.kts`, `APP/ios/Runner.xcodeproj/project.pbxproj` and `APP/README.md`.

- [x] Pin the validated Flutter SDK version and retain lockfiles. Separate ordinary PR checks from protected signed-release jobs. Restrict signing credentials to trusted release contexts.
- [x] Validate HTTPS hosts, nonempty publishable auth configuration, Sentry environment/DSN and pin configuration before compilation. Reject local/staging hosts in production. Reject service-role/provider/private keys from mobile build inputs.
- [x] Test the validator with missing fields, HTTP URLs, wrong environment hosts, valid public configuration and prohibited secret-key fields; failures exit nonzero without printing values.
- [ ] Build from `APP` with environment-specific, untracked configuration supplied by the pipeline:

```sh
flutter analyze
flutter test
flutter build appbundle --release --obfuscate --split-debug-info=build/symbols/android --dart-define-from-file=config/release.json
flutter build ipa --release --obfuscate --split-debug-info=build/symbols/ios --dart-define-from-file=config/release.json
```

- [x] Create the ignored `config/release.json` from protected build inputs in the job, then remove it. Required public fields are `API_BASE_URL`, `WEBSITE_BASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SENTRY_DSN`, plus the pin fields defined by Task 6. No provider secrets belong here.
- [ ] Supply Android upload signing and Apple signing through the existing secure release process. Archive signed artifacts, hashes, commit, build number and symbols. A signing/configuration failure leaves this task incomplete.
- [ ] Install and launch both exact artifacts; verify startup, correct environment and one sanitized crash report symbolicates in Sentry. A web build is not a substitute.

## Task 8 — Run physical-device acceptance

**Files:** Add focused `APP/integration_test/` scenarios and record results in `DOCS/MOBILE-LAUNCH-CHECKLIST.md`. Reuse existing test helpers for unit/widget cases; do not substitute mocked APIs for staging evidence.

- [ ] On at least one real Android and one real iPhone, exercise registration/email verification, password recovery, PIN setup/reset/lockout, login/logout/session revocation and background/resume.
- [ ] First exercise manual Exchange from collection instructions through receipt upload and admin verification for both wallet-credit and bank/MoMo outcomes; verify atomic wallet credit and actual external settlement evidence; confirm customer state survives restart and changes only with server events. Then exercise KYC approved/rejected/review/provider-unavailable outcomes, account provisioning, confirmed funding, internal transfer, withdrawal plus OTP and each enabled VTU service. Compare receipts to backend references and ledger/provider records.
- [ ] Interrupt network before send and after server commit; kill/relaunch the app; confirm one financial effect and correct recovery. Verify pending, failed and reversed status truthfulness.
- [ ] Check small screens, large text, TalkBack/VoiceOver, keyboard obstruction, offline startup and slow network. Profile launch/PIN interaction on the slower device and address measured stalls; avoid a speculative rewrite.
- [ ] Attach build number, device/OS, environment, date, operator and masked evidence for each case. Any skipped service remains disabled or blocks launch.

## Task 9 — Make support and operations sufficient for version one

**Files:** Reuse `APP/lib/features/home/screens/dashboard_detail_screen.dart`, `APP/lib/services/home_data_service.dart`, backend support routes and existing operational guides. Extend focused support tests.

- [x] Replace static “notifications” claims with honest activity/status information from existing transaction, KYC and support data. Fetch on foreground/resume and user refresh. Persistent push/read-state is explicitly post-launch, not represented as completed.
- [ ] Show account-closure request reference/status from existing support tickets. Test submission → reopening the app → seeing the request → operator resolution. Ticket creation alone must not display “account deleted”.
- [ ] Exercise receipt-linked support, unmatched deposit, pending withdrawal and VTU timeout escalation using existing admin tools. Verify admin actions are authorized and audited.
- [ ] Configure and trigger alerts for payment/provider failures, stuck pending work, reconciliation mismatch and readiness/Redis failure. Record recipient, response owner and successful delivery without posting credentials or PII.
- [ ] Rehearse backup restore into an isolated environment and the service kill switch. Follow existing rollback/compensating-entry procedures; never delete ledger history to fix discrepancies.
- [ ] Keep three consecutive reconciliation cycles clean before expansion, as required by the existing reconciliation guide.

## Task 10 — Close external gates and run the pilot

- [ ] Complete the owner-action table in `DOCS/MOBILE-LAUNCH-CHECKLIST.md`: providers, signing, domains/pins, devices, support owner and release approvals.
- [ ] Complete the existing internal-transfer and Ninja live-activation registers against the exact release candidate. Do not carry forward old local test counts as new evidence.
- [ ] Prepare store privacy/data-safety/account-deletion and financial-services declarations using the actual enabled features. Validate the current store requirements at submission time; obtain the accountable owner's approval.
- [ ] Have Engineering, Finance/Ops, Security and the required privacy/risk/release owners record approval. Roles may be shared where permitted, but existing dual-control requirements remain.
- [ ] Run authorized controlled live smoke transactions with documented accounts/limits and reconcile them. Keep general money movement disabled until these gates pass.
- [ ] Follow the existing transfer rollout: staff-only for at least 24 hours, then 1%, 10%, 25%, 50%, 100%, holding each stage at least one business day. For a small tester pool, use a documented cohort count consistent with the same gradual exposure.
- [ ] Stop expansion on any duplicate debit, negative balance, unexplained mismatch, PIN bypass, sensitive-data leak or critical readiness failure. Disable the affected service, preserve evidence and reconcile before re-enable.
- [ ] Reassess the scoped app using the original weighted categories. Record what is verified, excluded and still unknown. Target 95+; never label the full international product 100% ready because version-one features were excluded.

## Review coverage and handoff

| Original finding | Resolution path |
| --- | --- |
| 1 — Memory-only payment attempts | Tasks 4, 5, 8 |
| 2 — Incomplete Exchange | Task 1: externally funded receipt-to-wallet OR bank/MoMo workflow; Tasks 5 and 8 verify it |
| 3 — Android biometrics | Tasks 2, 8 |
| 4 — Pinning/integrity placeholders | Task 6 |
| 5 — Native CI missing | Tasks 7, 8 |
| 6 — Startup/Sentry verification | Task 7 |
| 7 — Errors displayed as empty | Task 3 |
| 8 — Lock/privacy policy | Tasks 2, 8 |
| 9 — Floating-point presentation | Task 3 |
| 10 — Static notifications | Task 9: truthful activity/status; native push deferred |

**After each task:** attach the changed-file diff and test/device evidence, update only the relevant checklist rows, and identify the next unmet dependency. Commit only the reviewed task files if committing; never stage the whole dirty workspace. Do not run unnecessary full suites again after unchanged documentation edits.

**Next engineering action:** run the implemented customer/admin journey against configured staging, produce signed candidates and collect physical-device evidence. **Immediate owner action:** provide staging configuration access, dedicated collection account/statement access, named payout operator and protected mobile signing inputs listed in the checklist; no credentials in chat.
