# Kora Ghana setup for TrustPay

Checked: 31 October 2026. Your existing account is a business/merchant MoMo wallet.

Status: Local integration implemented, with all Kora product flags off by default. Paystack remains the NGN provider. No Kora merchant account, credentials, signed sandbox fixture, product approval or live payment has been verified. Migrations have only been applied to a disposable financial test database.

## What your existing MoMo wallet can do

Keep your existing merchant wallet. It is separate from a Kora merchant account. Payments made directly to that old wallet will not automatically appear in TrustPay through Kora. Automatic confirmation requires a Kora-created payment request or supported Kora-issued receiving account.

For MoMo collection, the customer approves a provider request on their own phone. Their MoMo PIN belongs in the operator's trusted prompt, never in a TrustPay form. If the API requests an OTP or redirect, the app must follow that authorization model and still wait for server verification. The TrustPay transaction PIN is a separate authorization for TrustPay money movement. [Kora MoMo integration](https://developers.korapay.com/docs/mobile-money-apis)

Ask Kora whether your specific merchant wallet can fund the GHS payout balance, which route/reference to use, and whether it can be a settlement destination. Do not assume an existing wallet balance is already available through Kora.

## Start here

1. Create a [Kora merchant account](https://merchant.korapay.com/) using TrustPay's actual registration country and business details.
2. Complete business verification. Prepare registration/incorporation and ownership records, business address evidence, representative identification and tax/licence information as requested. The exact list depends on the country and business type; Nigerian CAC examples in generic documentation are not a Ghana document list. A merchant MoMo account alone does not establish eligibility for an exchange business. [Kora onboarding](https://support.korapay.com/hc/en-us/articles/33568056317842-Onboarding-on-Kora)
3. Describe TrustPay's real wallet and cedi/naira exchange model to Kora and obtain confirmation that they can serve it. Request Ghana MoMo collections, GHS virtual accounts, GHS MoMo payouts and the supported GHS funding/settlement arrangement. MoMo collection needs account activation and product enablement. [MoMo availability](https://developers.korapay.com/docs/mobile-money), [merchant agreement](https://www.korahq.com/merchant-service)
4. Start in Test Mode. Store test secrets only in the backend's local/deployment secret store. Never put secret keys in Flutter, browser configuration or chat.
5. In staging, register the deployed HTTPS webhook and server payout IPs in Kora. Use the approved funding instructions to prefund GHS payouts. Test collection and payout recovery before switching to live credentials.

## Message you can send to Kora

Send this yourself to **support@korapay.com** or your assigned merchant contact. No message has been sent by this review.

> We operate TrustPay, with NGN payments through Paystack and a proposed separate GHS integration with Kora. Customers will fund a GHS wallet or a specific exchange order through Ghana MoMo/GHS virtual accounts. We maintain our own GHS and NGN treasury balances and want automatic verified collection notifications and GHS MoMo disbursements. We already have a business/merchant MoMo wallet. Please confirm eligibility for this wallet/exchange model, required business and customer documents, GHS virtual-account access and limits, supported MoMo networks, payout access, fees, settlement timing, prefunding instructions, merchant-wallet funding/settlement support and webhook/test-account requirements. Please also confirm whether Ghana bank payouts are available for our account; we will not assume that MoMo payout access includes them.

Paystack must separately confirm that exchange-related NGN activity is permitted for TrustPay; using separate providers does not resolve its published restrictions. [Paystack eligibility](https://support.paystack.com/en/articles/2127042)

## How it works in this build

Customer payments use the Flutter app. The customer web dashboard retains the existing redirect to the app-download page. The web admin queue is **Exchange → Exchange requests**, at `/admin/exchange/provider`; historical manual orders retain their original workflow.

| Customer action | Provider and intended result |
| --- | --- |
| Fund a naira wallet | Existing Paystack NGN flow |
| Fund a cedi wallet by bank transfer | Kora GHS virtual account, verified deposit, one GHS wallet credit |
| Pay an exchange order from MoMo | Kora charge bound to that order, verified payment, one funded order; no extra wallet credit |
| Exchange existing cedi balance for naira | One GHS wallet debit/reservation, then a Paystack NGN payout from TrustPay's prefunded NGN balance |
| Exchange naira for cedis | One confirmed NGN funding event/reservation, then Kora GHS MoMo payout from TrustPay's available GHS balance |

Automatic confirmation means: provider notification → signature check → server-side payment query → customer/account/currency/amount/reference checks → one transactional financial update. Customers do not upload a receipt for normally matched Kora payments. Unmatched or contradictory events stay in review.

A permanent customer GHS receiving account identifies the customer's wallet, not a particular exchange order. Its deposits must fund that wallet. They must not also settle an external exchange or automatically spend the wallet. Direct external MoMo orders have their own provider charge reference. This prevents one deposit paying twice or an unrelated deposit triggering an old exchange.

Kora documents GHS account creation as asynchronous, with an account-creation notification and a query endpoint. Show account details only once active. The specific guide states a default limit of 50 accounts; confirm your approved capacity before launching. [GHS account guide](https://developers.korapay.com/docs/accepting-payments-with-a-ghs-virtual-bank-account)

## Where your existing cedis go

Kora distinguishes money received but pending settlement from the balance available for payouts. Use the funding instructions shown for your enabled GHS balance; ask support if no GHS method appears. A customer payment notification does not itself establish that the same money is spendable in the payout balance. [Available and pending balances](https://developers.korapay.com/docs/get-balance)

Your GHS funds would cover Kora's cedi payouts and fees. Your NGN funds would cover Paystack's naira payouts and fees. No automatic currency-conversion API is required for this model. TrustPay freezes the rate and records the obligation; treasury replenishment remains a separate operation. A low provider balance must queue the payout and show a clear status, not show a successful transfer.

Kora's public payout list includes Ghana MoMo destinations. Ghana bank payouts must remain unavailable unless the actual product access and API are confirmed. [Payout coverage](https://developers.korapay.com/docs/send-payments)

## Backend connection settings

Set these in the backend secret/configuration store. Keep product flags off until staging acceptance and business approval:

- `KORA_SECRET_KEY`: backend secret; use the appropriate test/live environment.
- `KORA_GHS_ENABLED=false`: keep creation and payout disabled initially.
- `KORA_GHS_VIRTUAL_ACCOUNTS_ENABLED=false`: enable only with approved account access and completed account tests.
- `KORA_GHS_MOMO_COLLECTIONS_ENABLED=false`: enable after MoMo authorization and verified collection tests.
- `KORA_GHS_MOMO_PAYOUTS_ENABLED=false`: enable after balance, recipient and payout tests.
- `KORA_EXCHANGE_USE_CASE_APPROVED=false`: record the product/corridor approval separately from possession of a secret.
- `PAYSTACK_EXCHANGE_USE_CASE_APPROVED=false`: enable exchange only after Paystack separately approves the actual business model.
- `KORA_GHS_DAILY_LIMIT=0` and `KORA_GHS_MONTHLY_LIMIT=0`: configure approved positive GHS limits, with monthly ≥ daily. Zero blocks withdrawals/exchange reservations. These do not change NGN limits.
- `KORA_GHS_PAYOUT_FEE_BUFFER=0`: reserve headroom in provider liquidity checks for your agreed payout fees.
- `KORA_REDIRECT_HOSTS=`: comma-separated exact HTTPS authorization hostnames confirmed by Kora. Redirects remain unavailable without an allowlisted host. Never add arbitrary user-supplied domains.
- Webhook: `https://YOUR_API_HOST/api/webhooks/kora`.

Kora's primary webhook guide specifies `x-korapay-signature` and HMAC-SHA256 over the serialized **data object**, which differs from Paystack's signing contract. Staging acceptance must pin this with an actual signed sandbox fixture; don't copy Paystack's verifier or accept multiple guessed signature schemes. A provider reference is then queried independently before value is delivered. [Webhook contract](https://developers.korapay.com/docs/webhooks)

Kora exposes API keys, webhook settings and payout IP configuration in its merchant dashboard. Confirm the actual dashboard controls available on your merchant account. [Technical FAQ](https://support.korapay.com/hc/en-us/articles/40023846563858-Technical-Support-Developer-FAQ)

## First usage after staging acceptance

1. In the app, use **Receive money → Receive cedis** (or **Add money → Add cedis**) for wallet funding. Choose MoMo or Bank transfer when enabled. Ghana bank details appear only after account activation.
2. For the priority exchange, open **Exchange → Cedis to naira**. Choose TrustPay balance or MoMo, enter the amount and Nigerian bank details, review the verified recipient, fee and total, then press **Withdraw** and enter the TrustPay transaction PIN.
3. Wallet funding reserves the confirmed GHS balance once. Direct external funding shows a MoMo payment request. Enter an OTP only when requested; enter the actual MoMo PIN only in the network prompt. The server verifies the collection before showing **Money confirmed**.
4. Admin opens **Exchange requests**, reviews the confirmed payment and masked recipient, then presses **Send naira**. For naira → cedis, the equivalent action is **Send cedis** through Kora MoMo.
5. **Sending** means submitted/awaiting confirmation. Only an independently matched provider query changes it to **Sent**. Use **Check payment status** after a delayed response; do not start a replacement payment. A timeout does not refund money or authorize another payout.
6. Ordinary GHS cash-out is separate: **Withdraw money → Withdraw cedis**, choose the network/number, review the server-verified recipient and amount, then authorize with the TrustPay PIN.
7. Failed wallet-funded payouts return the reserved source funds exactly once after verified terminal failure/reversal. Failed external-order payouts remain an admin reconciliation obligation; they do not invent a customer wallet credit. An expired but confirmed external order requires the admin to explicitly honor its original frozen quote. An already dispatched obligation cannot be dispatched again from Send.

Before staging, generate the Prisma client and deploy migrations `042`–`045` to the approved staging database. The local disposable test database already has them; no normal development or production database was migrated by this task.

## Implemented endpoints

All paths below include the `/api` prefix. Customer paths require JWT ownership; admin paths require JWT plus ADMIN. Mutations require `Idempotency-Key` through the global interceptor; financial creation also has durable domain-specific replay protection. No provider secret is returned.

| Path | Purpose |
| --- | --- |
| `GET /ghana/capabilities` | Product flags; configuration is not merchant acceptance |
| `GET/POST /ghana/account` | Read/recover or consent to an asynchronous owned receiving account |
| `POST /ghana/collections` | Owned wallet or order-specific MoMo charge |
| `GET /ghana/collections/:id`, `POST .../:id/refresh`, `POST .../:id/authorize` | Owned status, independent query and OTP next step |
| `GET /ghana/operators`, `POST /ghana/recipients/resolve` | Ghana MoMo destination verification |
| `POST /ghana/withdrawals`, `GET .../:reference`, `POST .../:reference/refresh` | Separate GHS wallet cash-out |
| `/exchange/provider/config`, `/quotes`, `/orders` | Capabilities, frozen quotes and owned exchange orders |
| `/admin/exchange/provider/orders`, `/orders/:id/send`, `/orders/:id/refresh` | Admin queue, release and verification |
| `/admin/exchange/provider/notifications`, `/notifications/:id/read` | Persistent notifications and per-admin read state |
| `GET /admin/payments/kora/readiness` | Read-only flags and available GHS balance; activation stays UNCONFIRMED |
| `POST /webhooks/kora` | Signed durable inbox, followed by an authenticated provider query |

Recovery jobs rotate through unresolved accounts, charges and outgoing attempts, including records that stay pending or fail a query. OTP next actions can be recovered by querying the original charge, and expired unused quotes can be safely closed before requesting fresh terms. Admin queues filter on the server and offer cursor-based Load more, so older funded obligations remain discoverable. A crash around dispatch or an ambiguous provider response remains reserved for reconciliation. No automatic resubmission or timeout refund occurs. A provider query lacking destination evidence remains unresolved. Validate the actual sandbox response shapes before launch.

## Acceptance before real customer use

Verify a successful collection, duplicate notification, missed notification recovered by query, rejected signature, wrong currency/account, failed MoMo approval, pending account creation, two concurrent payment requests, insufficient payout balance, lost payout response and a failed/reversed payout. Reconcile wallet deposits, direct-order funding and treasury top-ups separately.

The full code change and test sequence is in [the integration plan](superpowers/plans/2026-10-31-kora-ghs-integration.md). This setup guide does not establish live merchant approval or production readiness.
