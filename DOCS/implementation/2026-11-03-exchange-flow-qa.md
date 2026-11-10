# Exchange flow verification — 3 November 2026

## Result

Both exchange directions pass the existing isolated settlement tests. No HTTP 500 or failed network response was reproduced in the signed-in Flutter exchange checks. Live completion remains blocked by missing production Tier 1 policy configuration, rather than by the exchange rates.

The hosted `/api/kyc/status` response reports `kycStatus: VERIFIED`, `kycTier: TIER_1`, and `tierOneLimits: null`. The three required settings are `TIER_ONE_NGN_PER_TRANSACTION`, `TIER_ONE_NGN_DAILY`, and `TIER_ONE_NGN_MAX_BALANCE`. The owner has been asked for approved values. No limits, KYC status, account tier, rate, or provider capability was changed during this pass.

## Live browser checks

The Flutter preview uses the loopback CORS proxy to `https://api.trustpayhq.com`, hosted on Dokploy.

- Both rate reads returned HTTP 200 with active, safe pricing: NGN→GHS uses input 87 with `SOURCE_PER_TARGET`, effective rate 0.011494; GHS→NGN uses input 85 with `TARGET_PER_SOURCE`, effective rate 85.
- NGN→GHS: amount entry, receiving-method selection, incomplete MoMo validation, searchable Ghana bank selection, bank-recipient entry, and the pre-authorization KYC check were exercised. Synthetic recipient details stayed in the unsent form.
- GHS→NGN: amount entry, the NGN-wallet receiving step, and the pre-authorization KYC check were exercised.
- Manual exchange configuration and order-history reads returned HTTP 200. Configuration advertises both source currencies, NGN delivery to bank/MoMo and GHS delivery to the NGN wallet.
- Ghana capability lookup returned HTTP 200. Automated MoMo name verification is disabled; the app correctly exposes the existing manual-review fallback. Bank name lookup is explicitly unavailable rather than fabricated.
- Both live paths stopped at the missing-limit gate before PIN authorization or order creation. Order history remained empty. No customer payment, identity decision, receiving-account opening, receipt upload, deposit confirmation, or payout was executed.

Screenshots: `output/exchange-ux/reverse-flow-receiving-qa.png` and `output/exchange-ux/tier-one-limit-blocker-qa.png`.

## Fresh automated verification

- Backend unit suite: **109 suites / 847 tests passed** using `npm test -- --runInBand`.
- Exchange HTTP contract tests: **3 suites / 29 tests passed** for `exchange.e2e-spec.ts`, `exchange-receipts.e2e-spec.ts`, and `exchange-deposit.e2e-spec.ts`.
- Real PostgreSQL exchange tests: **4 suites / 54 tests passed** for manual exchange, quote exchange, provider exchange and rate safety. A fresh database named `trustpay_financial_test_exchange_20261103_qa` received the repository migrations. External authentication/payment/storage boundaries remain synthetic. Coverage includes receipt evidence, NGN wallet credit, cedi external payout confirmation, replay, concurrent execution/admin review, rollback, insufficient balance, ownership, reconciliation and crossed-rate rejection.
- Flutter exchange tests: **50 tests passed** across converter, manual exchange screen/service/order screen and provider exchange screen tests.

These checks establish application behavior under the test boundaries. They do not certify real merchant settlement or remove the need for approved production limits and provider activation.
