# TRUSTPAY Current Functionality Coverage

Date: 2026-05-18

This review covers the user app, backend banking flows, exchange flow, and admin operations. It separates what is functional now from what must be completed before real money launch.

## Functional Now

- User auth through backend/Supabase-backed session flow.
- User wallets for NGN and GHS are provisioned.
- Dashboard can load real user, wallet, transaction, and virtual-account data from the backend.
- Internal transfers have backend support.
- Withdrawal request path exists and debits/reserves wallet funds before provider transfer.
- Provider webhook controllers exist for Paystack and Flutterwave.
- Admin banking endpoints exist for overview, virtual accounts, provider events, pending withdrawals, reconciliation, and audit logs.
- Mobile quick actions route to Fund, Send, Withdraw, Exchange, Airtime, Data, Electricity, Wallets, Virtual Account, and Activity pages.

## Fixed In This Review

- The mobile bottom navigation now uses `Home`, `Exchange`, `Analytics`, and `Profile`; the old `History` tab was removed.
- Unknown withdrawal provider/API errors now leave the withdrawal `PENDING` with funds reserved instead of marking it `FAILED` and refunding immediately.
- Generic admin transaction status mutation is now blocked. Admins must use typed audited flows for financial status changes.
- Wallet cards were improved to remove wallet-name filler text and show stronger currency cards.
- Wallet manage page now distinguishes active wallets from supported/planned currencies.

## Not Fully Functional Yet

- Real exchange payout flow is not implemented. Current exchange is wallet-to-wallet FX and credits the opposite user wallet immediately.
- Admin cannot yet approve or process exchange payout orders.
- Admin web UI does not yet expose all banking operations queues.
- Admin wallet/treasury settlement model is not explicit.
- Provider onboarding and production credentials still control real virtual accounts, bank transfers, data bundles, and electricity payments.
- Data and electricity screens submit basic requests, but provider catalog/package selection still needs real provider configuration.

## Launch Blockers

- Real provider credentials and webhook URLs must be configured outside local development.
- Exchange payout must become a pending order with admin approval and settlement controls.
- Admin UI must show pending withdrawals, pending exchange orders, provider events, reconciliation, and audit logs.
- Withdrawal limit counters must be enforced atomically inside the same transaction that reserves funds.
- Deposit verification must always compare provider amount, currency, and reference before crediting a wallet.
