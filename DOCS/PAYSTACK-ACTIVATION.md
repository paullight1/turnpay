# Paystack activation and payment operations

TRUSTPAY's new Nigerian payment flows use Paystack. Identity validation uses BVN plus the customer's existing bank account; NIN upgrades use the audited manual review queue. VTpass still fulfills airtime and bills. Paystack receives NGN; TRUSTPAY's separate exchange workflow controls conversion and settlement.

## Configure the backend

Set these values in the backend secret/environment store, then deploy the code and apply the additive Prisma migration using the existing release procedure:

```dotenv
PAYSTACK_SECRET_KEY=YOUR_PAYSTACK_LIVE_SECRET
KYC_PROVIDER=paystack
BANKING_PROVIDER_PRIMARY=paystack
BANKING_ENABLED=true
VIRTUAL_ACCOUNTS_ENABLED=true
WITHDRAWALS_ENABLED=true
PAYSTACK_CHECKOUT_ENABLED=true
```

`PAYSTACK_DVA_PREFERRED_BANK` is optional. Leave it empty to discover an available bank for the merchant; use `test-bank` with test keys. This value is a DVA bank slug, not a transfer bank code. Production rejects test secret keys. Existing database, Redis, encryption, authentication and storage settings remain required.

The secret key stays on the backend. Hosted checkout does not require a public key in either client. Paystack signs callbacks with the same secret key; there is no separate `PAYSTACK_WEBHOOK_SECRET` setting.

Set `WEB_URL` to the deployed website's HTTPS origin. Hosted checkout returns to `/dashboard/fund`; the client then calls the authenticated verification endpoint. Mobile users can reopen the app and verify their saved attempt. A browser return or “I have paid” action never credits a wallet on its own.

## Configure the merchant dashboard

Register `https://YOUR_API_HOST/api/webhooks/paystack` as the Paystack webhook URL. It must reach the deployed backend with the unchanged raw body and `x-paystack-signature` header. Successful durable acceptance returns HTTP 200.

Confirm the business has access to dedicated accounts, customer validation and transfers. Confirm transfer approval settings match automatic payouts. Paystack transfer OTPs belong to the merchant and must never be entered by a customer. If merchant approval is required, operations resolves it in Paystack's merchant controls while TRUSTPAY keeps the transfer pending.

Ensure the Paystack balance can cover withdrawals plus provider fees. Adding a secret key cannot grant merchant product approval, configure an external webhook or supply payout liquidity.

## Check readiness

`GET /api/payments/capabilities` returns configuration and feature availability to authenticated clients. Configuration is distinct from confirmed merchant activation. Disabled or unconfigured features must remain unavailable in the clients.

An administrator can call `GET /api/admin/payments/paystack/readiness` for read-only API connectivity, DVA-provider availability and balance-access checks. This endpoint does not initiate a charge, transfer or identity check. It cannot prove that a real withdrawal or BVN check will succeed.

Existing payment inbox monitoring and withdrawal reconciliation remain in use. An authenticated successful event is independently confirmed through Paystack before new value is credited or a withdrawal reservation is released. HTTP timeouts remain pending until resolved; do not manually create a replacement transfer to compensate for an unknown status.

Hosted checkout has a minimum amount of NGN 50. Checkout references use Paystack's permitted transaction-reference characters; transfer references are lowercase and between 16 and 50 characters. A definite rejection before Paystack accepts a transfer releases the reserved wallet funds and withdrawal counters atomically. An unknown transport result remains pending.

If checkout initialization returns `PENDING` without an authorization URL, treat the attempt as unresolved: check its status using the returned reference and do not start a replacement checkout. If it remains unresolved or no hosted URL is available, give the reference to support/operations for Paystack-dashboard review and reconciliation before any new payment is attempted. A client timeout alone cannot prove whether Paystack accepted the original initialization.

The incoming-checkout state machine permits `PENDING → FAILED` for independently confirmed failed/abandoned payments, and `PENDING → SUCCESS` for confirmed receipt. If Paystack later independently confirms that an earlier `FAILED` checkout actually received funds, `FAILED → SUCCESS` is allowed only after matching the stored owner/customer, reference, currency and exact amount. The reference allocation, guarded status transition and unique ledger posting must produce one credit. This correction applies only to incoming checkout funding; it does not authorize retrying or reviving a failed withdrawal.

Paystack identity submissions use a fixed identity fingerprint per customer. A changed BVN, bank account or legal name after submission needs support review; a transport retry cannot silently substitute different identity details. Provider identity state and manual evidence decisions retain separate audit trails.

## Acceptance before enabling live traffic

Use an isolated test environment and test credentials first. Verify the following with authorized test customers:

1. Submit BVN, matching bank details and consent. The API remains pending until customer identification completes.
2. Confirm a validated BVN grants Tier 1; request a DVA and observe account preparation independently. An account failure must not erase identity verification.
3. Fund through the DVA and hosted checkout. Replay the webhook and verification request; confirm exactly one ledger credit per provider reference.
4. Submit NIN evidence for manual review; verify a typed number/upload alone grants no tier. An authorized review with sufficient evidence can complete the existing Tier 2 requirement.
5. Withdraw to a verified destination. Confirm pending, success and failed/reversed handling, with exactly one compensating credit where appropriate.
6. Check a lost client connection, delayed webhook and application restart. Attempts and account preparation must recover without creating a second financial operation.

After those tests and merchant activation, perform a separately authorized low-value live acceptance test. Automated local tests do not establish live readiness.

## Existing Monnify obligations

Do not relabel historic accounts, payments or transfer attempts as Paystack. Existing receiving accounts and pending obligations retain their original provider. Keep the Monnify webhook and reconciliation credentials available while existing deposits/transfers require them. New account requests and new payment requests use the configured Paystack primary.

The checked-in deployment manifests describe the Paystack setup for new deployments. When updating an existing deployment, retain its legacy credentials in the secret store; do not replace the whole environment with the new template while Monnify obligations remain.

Existing customers give Paystack-specific validation/account consent when enrolling in the new account flow; no background mass submission of identities is required. Display an active Paystack account as the preferred receiving account and label the old account clearly.

Disable or retire legacy receiving accounts only after provider confirmation and operational reconciliation. Before removing legacy credentials, clear pending transfers, inbox events, exchange allocations and reconciliation exceptions, and confirm how deposits to all old accounts will be handled.

New Monnify-specific exchange deposit requests are disabled with Paystack primary. Users can fund their NGN wallet through Paystack and use the existing supported TRUSTPAY exchange flow. Previously recorded exchange intents remain reconcilable.

## References

- [Paystack customer validation](https://paystack.com/docs/identity-verification/validate-customer/)
- [Dedicated virtual accounts](https://paystack.com/docs/payments/dedicated-virtual-accounts/)
- [Signed webhooks](https://paystack.com/docs/payments/webhooks/)
- [Transfer lifecycle and merchant approvals](https://paystack.com/docs/transfers/how-transfers-work/)
