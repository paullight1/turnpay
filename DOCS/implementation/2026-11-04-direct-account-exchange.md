# Direct-account exchange V1 — 4 November 2026

New cedis→naira orders collect the customer's Nigerian bank, ten-digit account number and beneficiary name. New naira→cedis orders retain Ghana bank/MoMo delivery. Admin verifies the actual incoming payment, claims the payout, sends the exact frozen amount externally and records the unique reference/private evidence. These actions never initiate another provider transfer or write to a customer wallet.

## Owner-approved limits

The owner explicitly confirmed **no exchange per-transaction or daily product limit**. Direct orders have no wallet dependency and do not consume wallet tier spend/balance allowances. The old 10,000,000 source-amount cap and proposed new limit settings were removed. Positive two-decimal source amounts, rates and computed payouts must remain exactly representable in the existing database money columns. No database balance precision was changed and no live policy values were invented.

## Correctness and recovery

- New reverse bank creation requires deliveryPolicyVersion=2, preventing older Ghana-only bank forms from collecting money for an incorrectly entered Nigerian beneficiary. The updated app preserves old journal bodies and original keys when recovering an earlier attempt.
- Committed create replays precede new version/availability gates; disabled new creation still exposes original-key recovery. Read-only historical destinations are not reinterpreted using the new account format.
- KYC, suspension and PIN checks, JWT/ADMIN authorization, DTO validation, frozen Decimal terms, private evidence, independent receipt verification, settlement holds, unique references and audits remain enforced.
- Customer/order row locks serialize duplicate creation and concurrent review. New ADMIN_EXTERNAL payout completion requires the claim owner, exact frozen amount, private proof and unique outgoing reference. Historical WALLET/LEGACY orders and ADMIN_CEDIS retain their original contracts.
- An already-sent supervised handover can finish only with its persisted exact-amount evidence and handover event. Unknown payout outcomes cannot authorize another send. Orders and quote expiry use database time.

## Verification

The final commands and local evidence are under `.superpowers/sdd/2026-11-04-direct-account-exchange/`.

| Check | Result |
|---|---|
| Backend full Jest suite | 111 suites / 884 tests passed. |
| Real PostgreSQL manual exchange, wallet-tier and quote exchange suites | 3 suites / 47 tests passed on a freshly migrated disposable database. Includes repeated large orders, concurrent idempotency, no-wallet Tier 1 settlement, independent wallet spending, private evidence, exact amounts, legacy recovery and rollback. |
| Backend strict TypeScript, production build, affected ESLint | Passed. |
| Admin desktop/mobile browser regression suite | 32 cases passed before owner limit steering; 10 targeted cases passed on the final unlimited policy, including a 16-character exact payout amount, cedi payout, legacy wallet, handover and responsive layout. |
| Web TypeScript and affected ESLint | Passed. |
| Flutter exchange converter/screen/service checks after limit removal | 53 tests passed. The final integrated full Flutter suite passed 569 tests and analysis reported no issues. |

An independent read-only review identified seven correctness/recovery issues, all addressed with regression coverage. Earlier local disk pressure caused compilation failures and transaction timeouts; those runs are not counted as successful verification. Subsequent isolated financial runs passed with unchanged production timeouts. Concurrent exchange receipt-UI edits were preserved and integrated. Their temporarily incomplete references/style findings were resolved; the final combined analyzer and full app tests are green.

## Activation

Apply migration `055_manual_direct_account_exchange` before deploying the updated backend. It expands the workflow discriminator without rewriting historical rows. Deploy the matching app/admin and verify dedicated receiving details, statement access, payout liquidity and the existing operational release requirements. No new exchange-limit settings are required. New order availability uses the manual-exchange feature switch and receiving configuration.

No genuine payment, identity decision, production configuration mutation or deployment was performed. Provider/auth/storage boundaries in automated acceptance remain controlled fixtures; real banking settlement acceptance is still required for public launch. Existing unrelated working-tree changes were preserved and no commit, merge or push was performed.

Current operator instructions: [Manual exchange admin triggers](../MANUAL-EXCHANGE-ADMIN-TRIGGERS.md).

Final verification: backend 111 suites/884 tests; financial 3 suites/47 tests; final desktop/mobile payout checks 10 tests; combined Flutter 569 tests; Flutter analyzer, backend/web strict types, backend production build, affected backend/web lint, Prisma validation and diff whitespace checks passed. Final financial database: `trustpay_financial_test_direct_exchange_unlimited_20261104` (disposable local PostgreSQL). Original seven review findings have regression coverage; no actionable finding was deferred. No new limit configuration or wallet-tier upgrade is required for direct exchange.
