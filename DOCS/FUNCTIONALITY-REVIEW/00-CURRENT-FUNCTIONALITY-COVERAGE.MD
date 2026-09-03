# TRUSTPAY Current Functionality Coverage

> Historical snapshot. For current provider/runtime status use `DOCS/PROVIDER-SOURCE-OF-TRUTH.MD` and `DOCS/CODEBASE-STATUS-REVIEW.MD`.

Date: 2026-05-22

This review covers the user app, backend banking flows, exchange flow, and admin operations. It separates what is functional now from what must be completed before real money launch.

## Functional Now

- User auth through backend/Supabase-backed session flow.
- User wallets for NGN and GHS are provisioned.
- Dashboard can load real user, wallet, transaction, and virtual-account data from the backend.
- Dashboard wallet cards show `Send Money` and `Receive Money`, and route to wallet detail screens with account details and history.
- Internal transfers have backend support.
- Withdrawal request path exists and debits/reserves wallet funds before provider transfer.
- Provider webhook controllers exist for Paystack and Flutterwave.
- Monnify NGN virtual-account provisioning and webhook processing are implemented.
- Monnify-verified exchange deposits can be matched to an exchange receipt and routed to admin review before GHS credit.
- Admin banking endpoints exist for overview, virtual accounts, provider events, pending withdrawals, reconciliation, and audit logs.
- Admin finance UI exposes Monnify health, virtual accounts, failed provider events, user wallets, exchange transactions, and exchange deposit review.
- Mobile quick actions route to Fund, Send, Withdraw, Exchange, Airtime, Data, Electricity, Wallets, Virtual Account, and Activity pages.

## Fixed In This Review

- The mobile bottom navigation now uses `Home`, `Exchange`, `Analytics`, and `Profile`; the old `History` tab was removed.
- Unknown withdrawal provider/API errors now leave the withdrawal `PENDING` with funds reserved instead of marking it `FAILED` and refunding immediately.
- Generic admin transaction status mutation is now blocked. Admins must use typed audited flows for financial status changes.
- Wallet cards were improved to remove wallet-name filler text and show stronger currency cards.
- Wallet manage page now distinguishes active wallets from supported/planned currencies.
- Monnify-only virtual account direction is documented.
- Manual exchange receipt flow now supports provider-verified Monnify deposits and admin credit.
- Dashboard wallet UI now makes Receive Money the primary funding language.

## Not Fully Functional Yet

- Real-money exchange launch still needs provider sandbox/live validation and e2e coverage for duplicate webhooks and duplicate admin review.
- Admin web UI still needs richer pending-withdrawal, transaction-detail, user-detail, ledger, and audit drilldowns.
- Admin wallet/treasury settlement model is not explicit.
- Provider onboarding and production credentials still control real virtual accounts, bank transfers, data bundles, and electricity payments.
- Data and electricity screens submit basic requests, but provider catalog/package selection still needs real provider configuration.
- Flutter mobile home still needs parity with the updated web wallet UX and should replace remaining mock home data.

## Launch Blockers

- Real provider credentials and webhook URLs must be configured outside local development.
- Exchange payout must become a pending order with admin approval and settlement controls.
- Admin UI must show pending withdrawals, pending exchange orders, provider events, reconciliation, and audit logs.
- Withdrawal limit counters must be enforced atomically inside the same transaction that reserves funds.
- Deposit verification must always compare provider amount, currency, and reference before crediting a wallet.
- Monnify webhook replay and admin exchange credit replay must be tested end to end.
- High-value admin credits and withdrawals need dual-control before launch.
