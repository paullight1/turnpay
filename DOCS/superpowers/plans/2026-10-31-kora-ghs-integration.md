# Kora GHS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add Kora for Ghana account funding, automatic verified cedi receipts and GHS MoMo payouts while preserving Paystack for NGN and the customer's simplified exchange/admin flow.

**Architecture:** Route by server-owned currency and stored obligation provider: NGN → Paystack, GHS → Kora, historical Monnify obligations → Monnify. Use durable account/collection/payout attempts, the existing webhook inbox and transactional ledger; never use receipt screenshots or currency guesses to authorize a payment. Keep a separate treasury balance in each provider; do not use Kora currency conversion in this scope.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Redis, existing HTTP/circuit-breaker services, Next.js/TanStack Query and Flutter/Dio.

**Spec:** `DOCS/superpowers/specs/2026-10-31-exchange-wallet-and-external-design.md`, with the user-selected Kora automation addendum below; operator requirements in `DOCS/KORA-GHANA-SETUP.md`.

**Status:** User approved inline execution on 31 October 2026. Implementation and local verification complete; live activation is not performed.

**Scope:** GHS receiving accounts, wallet funding, direct MoMo exchange funding and exchange payouts. Existing NGN banking stays intact. Ordinary GHS wallet cash-out can use the same Kora payout boundary with its own wallet reservation; it must not reuse an exchange reservation or silently fall through the NGN-only withdrawal form. Ghana bill payments, new Ghana identity verification products and bank payout methods not documented/enabled for the merchant are outside this change.

Execution note: Task-owned changes remain uncommitted in the shared dirty checkout to preserve unrelated user work. Review used an initial source snapshot. Customer web remains mobile-only; customer UI is Flutter and operator UI is web. See `DOCS/KORA-INTEGRATION-VERIFICATION-2026-10-31.md` for evidence, recovery fixes and limits.

## Global Constraints

- Preserve `DOCS/SECURITY-RULES.MD`, existing Tier 2 exchange/withdrawal requirements, suspension/PIN/reset holds, limits and reconciliation controls.
- “Preserve the extensive unrelated working-tree changes.” Reuse this checkout; stage/commit only task files and task-owned hunks.
- Monetary persistence/calculation uses Decimal; API money fields are decimal strings. Do not copy Paystack's kobo conversion into Kora's major-unit amount contract.
- Every customer/admin mutation requires a validated DTO, correct ownership/roles and durable idempotency. Webhooks require the exact provider signature contract before durable acceptance.
- “Never mark the parent transaction successful at approval or dispatch.” Query and match the persisted outgoing payment before settlement or compensation.
- No production credentials, deployment or live money movement is authorized by local implementation. No keys or MoMo PINs in chat/client code/logs.
- NGN stays Paystack; Kora is enabled only for GHS. Keep legacy Monnify routing by the stored provider. Never use Kora as a silent retry provider for a Paystack obligation.

## User-selected Kora automation addendum

The latest request selects two independent providers and automatic incoming-payment checks. This replaces the earlier proposal's manual GHS receipt checking and its manual GHS MoMo payout fallback when Kora capabilities become available. Unconfigured/unsupported methods remain visibly unavailable; historical manual obligations keep their original settlement route.

Keep the originally requested admin send action after automatic funding verification. Full unattended payout release is not required to remove manual receipt checking. The user has a **business/merchant MoMo wallet**, not a verified Kora merchant connection. Treat Kora onboarding and product approval as external activation requirements.

Kora supports permanent GHS virtual accounts and order-specific MoMo charges. Use customer GHS accounts exclusively for wallet funding. Direct external exchange orders use a Kora charge whose persisted reference identifies the order; do not match a generic wallet deposit to an order by amount, email or latest pending order. Bank transfer customers automatically fund their wallet, then authorize exchange from that balance; direct bank-to-order execution stays unavailable without unambiguous supported payment attribution. Treasury top-ups never credit a consumer wallet.

Official contract references: [GHS accounts](https://developers.korapay.com/docs/accepting-payments-with-a-ghs-virtual-bank-account), [MoMo authorization](https://developers.korapay.com/docs/mobile-money-apis), [webhooks](https://developers.korapay.com/docs/webhooks), [payouts](https://developers.korapay.com/docs/payout-via-api), [balances](https://developers.korapay.com/docs/get-balance).

## Review Focus

- An unrelated deposit to a customer's permanent GHS account must never pay an external order or cause a second credit (Task 4).
- A signed callback with the wrong account, currency, amount or recipient cannot move funds (Tasks 2 and 4).
- A lost response after provider dispatch must reuse/query the original reference without another payout or refund (Task 5).
- A pending Ghana account must not expose dummy receiving details or cause duplicate provisioning after restart (Tasks 3 and 6).
- Having cedis in an existing merchant MoMo wallet must not be presented as Kora available balance or merchant product approval (Tasks 1 and 6).

## Task 1: GHS capabilities and provider persistence

**Files:** Modify `BACKEND/prisma/schema.prisma`, `BACKEND/src/app.module.ts`, `BACKEND/.env.example`, `BACKEND/scripts/validate-production-config.sh`, `BACKEND/src/banking/providers/banking-provider.types.ts`; create additive migration after `041_paystack_kyc_and_account_state`; create `BACKEND/src/kora/kora-capabilities.service.ts` and `.spec.ts`.

**Interfaces:** `KoraCapabilitiesService.get(): {enabled:boolean; virtualAccounts:boolean; momoCollections:boolean; momoPayouts:boolean; useCaseApproved:boolean; configured:boolean}`. Expose server capabilities without secrets; currency routing is `providerForCurrency('NGN'|'GHS'): 'paystack'|'kora'` for new obligations only.

- [x] Write capability tests asserting GHS is unavailable by default, production rejects enabled features without live credentials, existing Paystack-only boot remains valid and an old MoMo wallet is not readiness evidence.
- [x] Run `npm test -- --runInBand kora-capabilities.service.spec.ts` from BACKEND; confirm failure because the new capability service is absent.
- [x] Add `KORA` to `PaymentProvider` and separate durable `KoraAccountRequest` and `KoraCollectionIntent` records. Requests need owned stable unique references, currency/purpose, request fingerprint, claim/status/recovery fields, timestamps and safe error category. Collection intents link uniquely to a wallet-funding transaction or exchange order, not both. Add indexes for due recovery and owned list queries. Keep existing VirtualAccount constraints and records intact.
- [x] Add the proposed Kora settings from the setup guide with default false product flags. Require exchange-use-case readiness for exchange release separately from account-only access. Add safe migration/deployment validation; do not change `BANKING_PROVIDER_PRIMARY=paystack` globally.
- [x] Run Prisma validation/generation without applying a migration to an unidentified database, then the new capability tests. Review additive SQL and commit only task-owned changes.

## Task 2: Exact Kora HTTP, money and signature boundary

**Files:** Create `BACKEND/src/kora/kora.client.ts`, `kora.module.ts`, `kora.types.ts`, `kora.client.spec.ts`, `kora-webhook-signature.ts` and `.spec.ts`; reuse `BACKEND/src/common/services/circuit-breaker.service.ts` and the HTTP/log-redaction patterns.

**Interfaces:** `KoraClient.request<T>(method:'GET'|'POST', path:string, body?:unknown, query?:Record<string,string>): Promise<T>`; `verifyKoraSignature(data:unknown, signature:string, secret:string): boolean`; `parseKoraMoney(value:unknown): Decimal`.

- [x] Write tests for invalid signature/header shape, altered data, Decimal boundaries, GHS major units, rejecting invalid precision/currency, redirects and safe handling of timeout/provider errors. Pin the published HMAC-SHA256 over `JSON.stringify(data)` contract, not the full Paystack raw-body signature.
- [x] Run the new test files and confirm the missing boundary fails.
- [x] Implement a fixed `https://api.korapay.com/merchant/api/v1` origin, strict relative path validation, backend Bearer secret, bounded timeout, no redirects, circuit breaking and safe errors without provider payload/secret logging. Serialize money from exact decimal values at the final transport boundary; use lossless numeric handling where required by the actual contract and reject unsafe values. Add no financial retry loop around POST.
- [x] Run tests; require a signed sandbox fixture during acceptance because Kora's generic FAQ and primary webhook guide differ in header descriptions. Do not accept guessed alternative signature schemes. Commit task files.

## Task 3: Ghana receiving accounts without changing Nigerian accounts

**Files:** Create `BACKEND/src/kora/kora-accounts.service.ts` and `.spec.ts`; modify `BACKEND/src/banking/banking.service.ts`, `banking.controller.ts`, `banking.module.ts`, `dto/banking.dto.ts` and related tests.

**Interfaces:** `KoraAccountsService.ensureAccount(userId:string, key:string): Promise<KoraAccountView>` and `refreshAccount(userId:string): Promise<KoraAccountView>` where `KoraAccountView` has provider KORA, currency GHS, status, masked number and active-only receiving details. Extend provisioning reads with a validated currency query defaulting to NGN for old clients.

- [x] Test GHS selecting Kora, NGN retaining Paystack, unauthorized currency/provider selection, pending creation, active refresh, same-key replay, concurrent calls and timeout recovery querying the stable account reference before another create.
- [x] Run focused account/banking tests and confirm the new behavior fails.
- [x] Implement validated GHS provisioning with trusted profile data, explicit consent and existing eligibility checks. Persist a request before the external call; do not insert dummy account numbers. Compare retrieved account reference/currency/customer binding to the saved request; never bind by callback email. Store a usable VirtualAccount only after active verification. Account-creation events trigger query/recovery, not wallet credit.
- [x] Run the account tests plus existing banking/Paystack tests, review schema ownership/uniqueness and commit task-owned changes.

## Task 4: Automatic verified collections and exactly-once allocation

**Files:** Create `BACKEND/src/kora/kora-collections.service.ts`, `kora-webhook.controller.ts`, `dto/kora.dto.ts` and associated specs; modify `BACKEND/src/payments/webhooks/webhook-inbox.service.ts`, `payment-webhook.processor.ts`, their tests, `BACKEND/src/common/services/deposit-allocation.ts` and its tests; add real-database financial tests under `BACKEND/test/kora-collections.financial.e2e-spec.ts`.

**Interfaces:** `KoraCollectionsService.createMomoIntent(userId:string, orderId:string, dto:CreateKoraMomoIntentDto, key:string): Promise<KoraAuthorizationView>`; `confirmCharge(reference:string): Promise<{routed:string; duplicate?:boolean}>`; `authorizeIntent(userId:string, intentId:string, dto:AuthorizeKoraMomoDto, key:string): Promise<KoraAuthorizationView>`. Proposed callback is POST `/api/webhooks/kora`. Views contain only allowlisted provider next actions, safe instructions and the owned intent ID.

- [x] Test that a verified GHS account deposit credits only its bound wallet once; an order charge funds only its bound order; duplicate callbacks/queries/concurrent workers cannot double-credit; mismatched amount/currency/account, client return redirects and customer screenshots cannot authorize value. Test that the same raw reference string in different providers cannot be confused, and one provider receipt cannot back funding and exchange simultaneously.
- [x] Run focused collection/webhook/allocation tests and confirm missing Kora routing fails.
- [x] Verify the signature before trusting financial fields, validate an event-specific DTO, durably enqueue, then acknowledge. Extend the existing worker with explicit KORA routing and bounded retry/recovery. Independently query `/charges/:reference`; match persisted intent or verified owned account reference. Preserve expected/gross/net/fees separately. Namespace new provider receipt identities without breaking historical allocation records or weakening cross-flow uniqueness.
- [x] For direct external MoMo exchange create a stable order-linked charge reference before dispatch; implement OTP, STK_PROMPT and REDIRECT next actions safely. Keep actual MoMo PIN entry with the operator. Reject expired/changed order terms, invalid callback origins and cross-user intents. Failed authorization never marks an order funded.
- [x] Commit wallet credit or order funding, deposit allocation, audit and persistent admin inbox event in one transaction. No HTTP call inside the transaction. Recovery after a lost commit response returns the original financial event.
- [x] Run unit/API tests and the new financial cases using only an explicitly disposable `trustpay_financial_test...` database. If none exists, record that limitation; never point tests at the ordinary development/production database. Commit verified task changes.

## Task 5: Frozen exchange execution and provider payout routing

**Files:** Extend `BACKEND/src/exchange/manual-exchange.service.ts`, `manual-exchange.policy.ts`, `dto/manual-exchange.dto.ts`, `exchange.module.ts`; create `BACKEND/src/exchange/provider-exchange-settlement.service.ts` and `.spec.ts`, `BACKEND/src/kora/kora-payouts.service.ts` and `.spec.ts`; modify `BACKEND/src/payments/payment.service.ts`, `dto/payment.dto.ts`, `withdrawal-reconcile.service.ts`, webhook routing and corresponding tests for GHS MoMo cash-out; add `BACKEND/test/kora-exchange.financial.e2e-spec.ts`. Correct premature success in legacy `exchange.service.ts` with its regression tests.

**Interfaces:** `KoraPayoutsService.sendMomo(attemptId:string): Promise<void>` and `reconcile(reference:string): Promise<void>`; `ProviderExchangeSettlementService.release(orderId:string, adminId:string, reason:string, key:string): Promise<ExchangeOrderView>`. Use the frozen-quote and wallet/external order contract in the spec, with one uniquely linked outgoing attempt.

- [x] Test quote/execution parity, one wallet debit across duplicate keys and concurrent spending, insufficient funds, exact frozen terms, expired quotes, verified external funding and the ready notification. Test approval retaining PENDING, concurrent admin release, timeout-before-response, duplicate/out-of-order callbacks, incorrect payout destination, insufficient provider liquidity and exactly-once compensation after independently confirmed terminal failure/reversal.
- [x] Run the focused exchange tests and confirm each new behavior fails before implementation.
- [x] Add owned durable payout quotes and single-use consumption as specified; source wallet debit and funded obligation are transactional. Existing GHS wallet funds require no new Kora charge. Retain customer PIN/holds and legacy admin separation rules. Do not call `PaymentService.withdraw` to send an already-reserved exchange; it would debit twice.
- [x] Route NGN outgoing attempts to the existing Paystack adapter and GHS MoMo attempts to Kora. Persist the unique attempt, stable provider reference, method and immutable beneficiary snapshot before dispatch. Resolve Ghana MoMo names/operators with Kora's supported APIs. Unsupported Ghana bank payout stays unavailable. Never reroute historical or uncertain attempts to another provider.
- [x] For ordinary GHS wallet cash-out, add a distinct validated mobile-money destination to the withdrawal DTO and route by currency. Reserve that withdrawal once using its own transaction, PIN/eligibility/limits and stable Kora attempt; extend normal withdrawal webhook/reconciliation routing to KORA. Test one GHS debit/refund, no NGN debit, rejected bank-only destination fields and unchanged Paystack NGN behavior. Keep the exchange release path separate so it never debits this withdrawal path again.
- [x] Match requery results against amount/currency/reference/destination before finalizing. If a payout query lacks recipient evidence, obtain the documented detail necessary to establish it or keep the obligation unresolved. Unknowns and missing provider balance queue safely; never mark success or refund on timeout. Keep source clearing, destination payable, fees and compensating entries reconcilable separately.
- [x] Run targeted exchange/Paystack regression and disposable-database financial tests; verify the production-independent failure evidence and commit task-owned changes.

## Task 6: Customer and admin UI for both providers

**Files:** Modify `WEBSITE/src/services/api.ts`, `src/types/index.ts`, `src/app/dashboard/fund/page.tsx`, `src/app/dashboard/exchange/page.tsx`, `src/app/dashboard/withdraw/page.tsx`, `src/app/dashboard/wallet/[currency]/page.tsx`, `src/app/admin/exchange/manual-orders/page.tsx`; update `APP/lib/services/home_data_service.dart`, `wallet_service.dart`, `APP/lib/features/wallet/screens/receive_money_screen.dart`, `APP/lib/features/home/screens/money_action_screen.dart`, `APP/lib/features/exchange/services/manual_exchange_service.dart`, exchange form/detail screens and their tests. Add focused web E2E specs.

**Interfaces:** Clients consume server currency capabilities, active/pending account view, immutable quote/order view and `KoraAuthorizationView`; provider secrets are never client fields. Existing provisioning defaults continue to work for NGN clients.

- [x] Test receive money no longer filters out active KORA/GHS accounts, pending accounts reveal no dummy numbers, wrong-currency amounts are rejected, secrets/PINs are not persisted, lost-response retry preserves the original attempt and capability errors remain visible.
- [x] Run focused Flutter/web tests and confirm missing GHS behavior fails.
- [x] Add a clear GHS/NGN choice and simple funding methods. Keep Cedis → Naira first, large You pay/You receive amounts, visible fees/total and one primary button. Explain MoMo approval on the phone and provider pending/low-liquidity states. Separate wallet deposits from direct exchange charges and from treasury balance. Never require screenshot uploads for automatically verified Kora payments.
- [x] When GHS cash-out capability is enabled, show Ghana MoMo operator/number and server-resolved recipient name rather than Nigerian bank fields. Test the transaction PIN path, exact destination currency, pending/failed result recovery and retention of existing NGN form behavior.
- [x] Admin shows persistent new funded orders, confirmed source funds and Send naira/Send cedis only where an actual provider dispatch is available. Incoming verification removes statement checking, not the original explicit release action. Preserve legacy manual evidence actions for old obligations.
- [x] Verify phone/desktop widths, keyboard-open forms, loading/errors/retry, notification read state and duplicate submission controls; run focused tests and commit task-owned changes.

## Task 7: Activation diagnostics, operator guide and final verification

**Files:** Create `BACKEND/src/kora/kora-readiness.controller.ts` and specs; update `DOCS/KORA-GHANA-SETUP.md`, `DOCS/PROVIDER-SOURCE-OF-TRUTH.MD`, environment/deployment checks and `DOCS/SECURITY-RULES.MD` phase record. Extend existing financial E2E configuration for the Kora test filenames.

**Interfaces:** Proposed ADMIN-only GET `/api/admin/payments/kora/readiness` returns configured/product flags, safe GHS balance availability and observed acceptance evidence; it must distinguish configuration from independently verified product readiness.

- [x] Test JWT/admin guards, throttling, unavailable Kora, no-secret responses and read-only diagnostics that never provision accounts, initiate charges or send money.
- [x] Implement diagnostics and update the setup guide's proposed/implemented markers from actual evidence. Preserve Paystack NGN defaults and document Kora GHS access separately. Do not label a key or balance response as acceptance of the exchange business model.
- [x] Run backend build/lint and targeted suites, web typecheck/lint/E2E and Flutter analyze/focused tests. Run financial E2E only against a disposable database. Verify migration SQL, reconciliation paths, secret redaction and preservation of unrelated edits.
- [x] Perform a fresh independent whole-change review required by the execution workflow. Resolve actionable issues before claiming completion. Report tests, remaining merchant activation, unsupported methods and untested live paths explicitly; commit only reviewed task-owned changes.

## Plan self-review

The tasks cover provider onboarding/configuration, async receiving accounts, distinct wallet/order funding, authenticated durable webhooks, exact money, bank/MoMo method constraints, source/provider treasury separation, frozen exchange terms, payout recovery, notifications, client UX and operational activation. The five review-focus failures have explicit test ownership. New money-moving features remain off until real merchant capabilities and staging evidence exist. No live key, account registration, provider-policy change or real payment is needed to implement/test the local code.

Recommended execution: **Native** in this checkout. The account, collection, quote and settlement contracts are tightly coupled and the current working tree contains substantial ongoing changes; a single implementer can preserve those changes consistently, followed by the required independent final review. Inline execution was approved by the user; see the execution ledger for evidence and rulings.
