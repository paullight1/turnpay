# Paystack activation and payment operations

TRUSTPAY's new Nigerian payment flows use Paystack. Identity validation uses BVN plus the customer's existing bank account; NIN upgrades use Ninja when explicitly enabled, otherwise the audited manual review queue. VTpass still fulfills airtime and bills. Paystack receives NGN; TRUSTPAY's separate exchange workflow controls conversion and settlement.

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

## Email verification and optional error reporting

Customer verification codes use the existing Supabase Auth email transport:

```dotenv
OTP_PROVIDER=supabase_email
OTP_LENGTH=6
OTP_EXPIRES_IN=5m
OTP_DEV_CODE=
SENTRY_DSN=
```

Sentry is optional by the owner's current instruction; structured server errors and audit logging remain enabled. A supplied DSN must still use HTTPS. Twilio credentials and `SMS_PROVIDER` are not required or used by the current OTP module. Password login, recovery links and server-verified transaction PINs remain in place.

In the matching Supabase project, include `{{ .Token }}` in both **Confirm signup** and **Magic Link** email templates, configure a six-digit email OTP and a 300-second expiry, and verify the existing SMTP sender/delivery configuration. Keep any existing confirmation/recovery links compatible; changing the project email expiry also affects other email links. Supabase's default development mail service is not sufficient evidence of production delivery to arbitrary customers; confirm a configured production SMTP sender and its sending limits.

`POST /api/auth/otp/send` accepts `{ "email": "customer@example.com" }`; `POST /api/auth/otp/verify` accepts that email and a six-digit `otp`. Both require an `Idempotency-Key`. Requests never create unknown identities. The backend bounds challenges to five minutes and three verification attempts using Redis; provider tokens are independently verified and never returned or stored in logs. Signup uses the confirmation email already sent by Supabase rather than sending a second code. A successful email code verifies email ownership; it does not verify the phone or grant KYC tiers. PIN reset verifies the authenticated account's saved email and retains the existing security hold.

## Configure the merchant dashboard

Register `https://YOUR_API_HOST/api/webhooks/paystack` as the Paystack webhook URL. It must reach the deployed backend with the unchanged raw body and `x-paystack-signature` header. Successful durable acceptance returns HTTP 200.

Confirm the business has access to dedicated accounts, customer validation and transfers. Confirm transfer approval settings match automatic payouts. Paystack transfer OTPs belong to the merchant and must never be entered by a customer. If merchant approval is required, operations resolves it in Paystack's merchant controls while TRUSTPAY keeps the transfer pending.

Ensure the Paystack balance can cover withdrawals plus provider fees. Adding a secret key cannot grant merchant product approval, configure an external webhook or supply payout liquidity.

## Check readiness

### Private NIN evidence and the first reviewer

The backend requires `SUPABASE_SERVICE_ROLE_KEY` from the same project as
`SUPABASE_URL` and `DATABASE_URL`. Keep it in the backend secret store only.
The publishable/anon key cannot create private signed evidence URLs. Configure
`KYC_DOCUMENT_BUCKET=kyc-documents`; the bucket must be private, with an 8 MiB
limit and JPEG, PNG, WebP and PDF allowed. Verify a private upload and an
expiring reviewer URL before accepting real NIN submissions.

Select an existing, email-confirmed, active TRUSTPAY account explicitly. The
first-admin command never creates an account or password, defaults to a dry
run, and refuses to grant a different account privileges once an admin exists:

```sh
# From BACKEND with server environment configured:
npm run admin:bootstrap -- --email reviewer@example.com --reason "Owner authorized first reviewer"
npm run admin:bootstrap -- --email reviewer@example.com --reason "Owner authorized first reviewer" --apply
# In the built production image, use admin:bootstrap:prod instead.
```

This assigns the existing **full ADMIN role**, including other administration
permissions, and records `INITIAL_ADMIN_PROVISIONED` atomically with the role
change, including the server process user and supplied authorization reason.
The process user identifies the executing OS principal, not an authenticated
human; include the owner's access request/ticket in the reason. It does not
grant KYC verification or change the reviewer's tier.
Database role checks authorize requests; customer-editable metadata and email
domains never grant access. Refresh the authenticated bootstrap/sign in again
to reveal the admin navigation.

Review NIN at `/admin/kyc` in the existing admin console. The reviewer opens
the private evidence, checks the profile match, enters a reason, and approves
or rejects. Evidence access and decisions are audited. The client supplies
idempotency keys; competing decisions are serialized and cannot overwrite a
completed review. A submitted NIN alone grants no tier. Existing tier rules
remain: either verified BVN/NIN qualifies for Tier 1; both qualify for Tier 2.
Paystack BVN decisions remain read-only to administrators.

### Prove public webhook delivery

Use an always-on backend for provider callbacks. Render Free spins down after
15 minutes without incoming traffic and can take about a minute to wake up;
an internal cron job does not remove this hosting limitation. Confirm the
actual service compute plan in Render, rather than assuming that a successful
deployment or a warm health check proves continuous availability.

`GET` and `HEAD /api/webhooks/paystack` provide a read-only endpoint description
with HTTP 200. They do not accept an event or prove delivery. Paystack event
delivery uses `POST` with `x-paystack-signature`; unsigned POST requests must
still fail. Before this endpoint-description change is deployed, GET/HEAD
return 404 even though the signed POST route exists.

1. Restore the existing deployed API and confirm its public HTTPS readiness
   endpoint. Do not register `localhost` or use an unverified development
   tunnel as a permanent merchant endpoint.
2. In the Paystack dashboard's matching Live/Test environment, register
   `https://YOUR_API_HOST/api/webhooks/paystack`. Preserve unrelated merchant
   settings. The public route must preserve raw bytes and reject unsigned
   requests with HTTP 400.
3. Inspect Developers → Webhooks or `GET /integration/webhooks/events` for
   the specific customer's `customeridentification.success`/`.failed` event.
   If a matching event failed delivery, resend that event only using the
   dashboard or `POST /integration/webhooks/events/resend` with its event ID.
   Do not broadly replay payment events or manufacture a signed success event.
4. Confirm durable HTTP 200 acceptance, a processed payment inbox record,
   exactly one `PAYSTACK_CUSTOMER_IDENTIFICATION_RESULT` audit, and the
   corresponding stored verification result. The worker runs every minute.
5. Check both KYC cards and server tier from the app. The refresh button reads
   saved backend status; it does not query Paystack or approve a pending check.

Changing the webhook URL cannot itself complete an identity check. A customer
that Paystack still reports as unidentified, with no terminal provider event,
remains pending and requires provider investigation if it persists.

#### Investigation on 2 November 2026

- Live custom-domain HTTPS requests reached NestJS. Unsigned POST returned
  HTTP 400 `Invalid signature`; an HMAC-signed empty JSON object advanced to
  DTO validation and returned HTTP 400 `event must be a string`. No event was
  accepted or manufactured. This establishes raw-body/signature handling for
  that diagnostic connection, not genuine Paystack delivery.
- The live Render dashboard showed Free compute. Available logs showed
  repeated hibernation starts, including 10:05 WAT today. This is a confirmed
  availability risk; the precise cause of Paystack's reported failure is not
  established without their delivery/probe details.
- At 01:17:21 WAT, a Postman GET reached the exact webhook path and received
  HTTP 404. Its sender cannot be identified from the available evidence.
  Browser GET/HEAD checks have the same result on the current deployment.
- Fresh official customer lookup returned HTTP 200, matching live customer,
  `identified=false`, and `identifications=null`. Official webhook history
  from 30 October returned zero events and no next cursor. Database inspection
  found no Paystack webhook log/inbox records. The existing verification is
  still PENDING with its accepted submission marker and recorded consent.
- No account-provisioning request exists for the customer. The service creates
  that request after genuine verified identification and account consent;
  missing BVN completion therefore also prevents account provisioning.

The GET/HEAD change addresses manual endpoint discoverability. Always-on
hosting addresses idle wake-up delays. Neither change can create a missing
provider decision. After deployment and hosting correction, verify a genuine
terminal event through the signed POST/inbox/audit path described above.

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

## BVN-first policy — 2 November 2026

The owner approved Tier 1 access to supported transfers, withdrawals, VTU and exchange within configured limits. NIN upgrades to Tier 2 and does not block an already verified Tier 1 customer. Earlier historical notes referring to either document granting new Tier 1 or universally requiring Tier 2 for withdrawals are superseded by KYC-GUIDE.MD.

Before enabling these new Tier 1 actions, install the approved per-transaction, daily and maximum-balance settings and an active Tier 1 internal-transfer policy. Missing policy deliberately keeps those actions unavailable; do not copy Tier 2 default allowances. Confirm licensed-partner/product acceptance separately. Ninja is disabled by default until authorized provider access is ready. No live customer decision, activation, configuration change or deployment was made by this implementation.
