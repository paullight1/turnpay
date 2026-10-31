# Paystack payments and onboarding migration

Date: 2026-10-30

Status: Execution authorized on 2026-10-30. The user requested self-critique, improvement and implementation without another approval round.

## Intent and agreed scope

TRUSTPAY will use Paystack for new supported Nigerian payment activity: customer validation, dedicated virtual bank accounts, wallet funding, bank resolution, beneficiaries and withdrawals. The website, admin and Flutter app must share these capabilities and accurately show pending and completed operations. Here, “virtual numbers” means dedicated virtual bank account numbers.

The user explicitly chose BVN plus bank-account verification for automated Nigerian KYC, with manual NIN/document upgrades. VTpass remains the bill and airtime provider. This request supersedes the previous Monnify-only provider policy.

The launch target is Nigerian NGN banking. Existing Ghana/FX accounting and history remain readable; this work must not imply that a Nigerian Paystack account supports Ghanaian onboarding, cross-border transfers or automatic FX settlement. Unsupported actions must be visibly unavailable with a reason, consistently enforced by the backend.

## Current implementation and migration gaps

The current checkout has no active Paystack provider, payment initialization route or Paystack webhook route. A `PAYSTACK` payment-provider enum and older design documents remain, but they do not constitute a working integration.

| Area | Current behavior | Required change |
| --- | --- | --- |
| Startup and deployment | `app.module.ts`, environment templates, manifests and validation scripts require Monnify | Paystack defaults and validated server credentials; update readiness and release checks |
| Banking | `BankingService` and `BeneficiariesService` inject `MonnifyVirtualAccountProvider` directly | Provider boundary for new Paystack operations and explicit legacy routing |
| KYC | Synchronous Monnify result; BVN submission requires an already verified NIN | BVN plus bank details; asynchronous identification result; manual document upgrade |
| Account preparation | Synchronous provisioning after KYC returns verified | Durable account preparation after identification completes, with independent retry |
| Tiers | BVN or NIN grants Tier 1; both grant Tier 2; withdrawals require Tier 2 | Preserve this policy; Paystack BVN validation alone never grants Tier 2 |
| Funding UI | Web funding page selects `monnify` and requests identity inputs again | Use verified onboarding data, explicit account request consent and Paystack account status |
| Payment webhooks | Monnify-only controller, inbox DTO and processor | Signed Paystack ingestion and event-specific workers |
| Exchange deposits | Explicit Monnify deposit-intent endpoints, metadata and allocation routing | Provider-neutral deposit allocation; Paystack NGN receipt matching without duplicating wallet credit |
| Clients | Provider literals in web API types, fund page and Flutter services | Capability-driven requests, consistent status types and migration messages |

There are extensive existing uncommitted changes across these same modules. Implementation must extend the current working tree, preserve unrelated edits and avoid resetting files or reintroducing retired KYC providers.

## Approach

Use Paystack for all new supported payment requests while retaining historical provider identity and a limited Monnify reconciliation path for existing obligations. This follows the requested provider consolidation without losing the ability to settle an old pending transfer or account deposit.

A blanket provider string replacement is unsuitable: authentication, amount units, event names, KYC inputs, customer correlation and payout statuses differ. A permanent multi-provider selector for end users adds complexity the requested consolidation does not need. Existing internal provider boundaries should support historical routing, without presenting a provider choice to customers.

Builder choices: use the existing NestJS HTTP client and durable inbox infrastructure; hosted Paystack checkout for amount-based funding; separate customer validation and DVA creation steps for explainable recovery. Do not add a client SDK unless an actual platform limitation requires it.

## Customer and KYC lifecycle

1. The user provides legal first/last name, BVN, an existing Nigerian bank account and its bank code, with explicit versioned consent for identity validation and optional account setup. Resolve bank details server-side to help catch entry errors; account-name resolution alone is not identity verification.
2. Persist a Paystack customer binding before requesting identification. Bind the provider customer code to the internal user, with a database uniqueness constraint. Do not correlate results by client metadata or mutable email alone.
3. Persist a verification attempt before the external call. Send `POST /customer/:code/identification` with `country=NG`, `type=bank_account`, BVN, bank details and legal name. An accepted response means pending, not verified.
4. Only one identification attempt per customer may be in flight. Paystack identification callbacks lack an internal attempt ID, so serialize attempts and match the persisted customer binding and current attempt. Delayed or ambiguous callbacks require provider requery/manual review; they must not approve a newer submission blindly.
5. `customeridentification.success` or `.failed` completes the matching attempt through the durable worker. Update document status, user status and tier, and write an audit record in one Prisma transaction. Duplicate or stale events cannot downgrade an existing verified result.
6. A verified BVN can grant Tier 1 according to existing rules. Preserve existing higher tiers and verified documents. An existing Monnify KYC result is not a Paystack validation result: an existing customer may need Paystack validation to obtain a new Paystack DVA.
7. NIN and supported document upgrades use a dedicated authenticated manual submission flow. The current upload-URL and admin-review endpoints are insufficient by themselves: implement document registration/submission, ownership and storage verification, encryption, consent, status tracking and an admin queue. Do not label a submitted NIN as verified until an authorized reviewer records a decision and evidence.
8. Keep existing Tier 2 evidence requirements and withdrawal limits. Manual NIN review must establish the evidence required by that policy; a reviewer cannot simply promote a tier without that evidence. Reject insufficient or unverifiable evidence with an actionable reason. Any later change to tier requirements is a separate explicit product decision.

Add `PAYSTACK` to `KycVerificationProvider` through an additive migration. Add a persistent provider-customer binding and attempt correlation fields as necessary; do not put raw identifiers in JSON metadata. Use encrypted columns for necessary BVN/account details, masked API output, response hashes and minimized encrypted/restricted webhook storage. Never emit full provider identity payloads to application logs.

## Dedicated virtual accounts

After verified Paystack customer validation and recorded account-setup consent, create a DVA using `POST /dedicated_account` and the saved customer code. Retrieve available provider bank slugs from Paystack; never confuse these with payout bank codes. A configured preferred bank must be available for the merchant and environment.

Persist a durable provisioning request with user, customer, currency, consent, state, attempts and error category before making an external call. Do not insert dummy account numbers to satisfy the current non-null `VirtualAccount.accountNumber` field. A separate provisioning record is preferable; only create the account record when usable details exist. Handle both immediate DVA details and assignment callbacks where applicable.

Return separate identity and account states: verification pending, identity verified/account preparing, account active, action required and provider unavailable. A DVA failure never reverses a successful KYC decision. Retry queries the bound customer's existing DVA first; it must not create duplicate assignments after timeouts. Serialize provisioning per user/provider/currency even for different idempotency keys.

Only active, complete account details are copyable. Show the actual issuing bank and provider account name returned by Paystack. Refresh status without issuing another creation request. Keep old account details associated with Monnify and clearly mark which account to use for new deposits; do not claim an old account has been closed until confirmed.

## Wallet funding and deposit ownership

Support bank-transfer funding through the DVA and amount-based hosted checkout. The backend initializes checkout with its own reference, expected amount/currency, authenticated owner, expiry and allowlisted callback. Persist the attempt before contacting Paystack. Return the authorization URL to clients; keep the secret key server-side. Use the same attempt and reference after an ambiguous initialization timeout.

Client redirects and mobile return links only trigger backend verification; they never authorize a wallet credit. Verify the transaction from the backend and compare reference, successful status, environment, amount, currency and bound customer to the stored attempt. Mobile return/cancel/resume must recover from the server record.

For a DVA deposit, independently verify the reference and match the verified receiving account/customer to the persisted Paystack account. Reject mismatched or missing ownership; quarantine unmatched payments for reconciliation instead of guessing by email. Bank-transfer deposits have no user-entered expected amount, so use verified provider minor units as the amount source.

Convert kobo with `Decimal`: require positive integer minor units; divide by 100 exactly for NGN. Convert outgoing decimal amounts by multiplying by 100 and validating integer/range constraints. Reject unsupported precision instead of rounding. Retain gross paid, provider fees and settled net distinctly. Preserve the current gross-credit policy; do not introduce an unapproved customer fee.

Allocate each verified provider reference once to either a checkout funding attempt, an eligible exchange intent or a DVA wallet deposit. Reuse the existing deposit-allocation control. Credit the wallet, create the ledger/transaction/audit record and mark processing complete in the same database transaction. Concurrent webhook and callback verification must produce one credit.

Paystack receives NGN for an eligible exchange intent; TRUSTPAY's existing quote, manual settlement and rate rules still govern conversion. Do not claim Paystack performs FX. Stop creating Monnify-specific intents for new activity; keep old intent reconciliation.

## Withdrawals and beneficiaries

Use Paystack bank listing, account resolution and transfer-recipient APIs. Persist the recipient code with the encrypted destination and provider identity. Re-resolve legacy beneficiaries before creating Paystack recipients; never treat a Monnify recipient/bank code as a Paystack one.

Keep transaction PIN, ownership, suspension, tier, daily/monthly limits and reconciliation holds. Reserve funds and counters atomically using existing ledger controls before initiating a transfer. Paystack transfer references must be lowercase alphanumeric with allowed hyphens/underscores; the existing uppercase `WD-...` format cannot be copied unchanged.

Initiate with `source=balance` and exact minor units. Map provider states explicitly: `pending`, `otp` and `received` remain pending; independently confirmed `success` completes; independently confirmed terminal failures release the reservation once. Reversal follows the documented financial state machine and creates at most one compensating entry. Unknown states, HTTP timeouts and “not found” immediately after submission remain unresolved for reconciliation; do not automatically refund them.

Paystack's transfer OTP belongs to the merchant. Do not repurpose the current customer withdrawal authorization screen to ask a customer for a merchant OTP. For automatic payouts, merchant transfer-approval settings must match the deployed integration. If approval is required, expose a restricted admin action and a customer pending state. Never change merchant security settings automatically.

Reconciliation chooses the provider stored on each transfer attempt. Reuse its original reference after ambiguous submission, and verify transfer amount, currency and destination before applying a final status. Never retry an old Monnify obligation through Paystack.

## Webhooks and recovery

Add `POST /api/webhooks/paystack`, returning HTTP 200 only after durable acceptance. Verify `x-paystack-signature` as HMAC SHA-512 of the raw body using `PAYSTACK_SECRET_KEY` and timing-safe comparison before trusting fields. Paystack uses its secret key for this signature; do not invent a required separate webhook secret.

Validate event-specific DTOs and persist the normalized envelope through the existing inbox/claim/retry/dead-letter pattern. Accept additive provider fields while strictly validating the financial fields consumed. Handle `charge.success`, `transfer.success`, `transfer.failed`, `transfer.reversed`, `customeridentification.success`, `customeridentification.failed`, `dedicatedaccount.assign.success` and `dedicatedaccount.assign.failed`. Unknown authentic events can be recorded and acknowledged without changing money or KYC state.

Financial idempotency uses provider plus transaction reference; identification/DVA callbacks use customer/resource identity, event type and payload hash with monotonic domain state. Preserve cross-event reversal handling. Queue recovery must survive a crash after the external request or database commit. Do not delete existing Monnify inbox work during cutover.

## UI behavior across web, Flutter and admin

Keep TRUSTPAY's existing visual system. Refactor the transactional journey across KYC, add money, receive money, send/withdraw, beneficiaries, transaction detail and admin KYC/payment operations.

- KYC: legal name, BVN, bank and account number, clear consent; pending verification; actionable mismatch; distinct manual-upgrade entry. No NIN-first blocker and no promise that BVN plus bank details completes Tier 2.
- Add/receive money: choose bank transfer or hosted checkout; show current account request state and one primary action. Do not request BVN again after successful onboarding. Show bank/name/account number only when active.
- Withdraw: resolved destination, server-provided fees and total, available balance, transaction PIN and confirmation. Show pending confirmation honestly; preserve the same attempt on retry.
- Transaction detail: amount/currency, fees, reference, provider, status, timestamps and support action. Show historic provider accurately.
- Admin: separate KYC approval, DVA provisioning and payment/reconciliation state; masked identity data, authorized evidence access and audited retry/review controls.

Use a server capability response for provider, market, funding methods, required KYC inputs, minimum tiers and temporary availability. Clients must not infer availability from hardcoded provider literals or key presence. Include loading, retry, empty, failure and success states, accessible labels, disabled submission and stable idempotency keys on every mutation. Never store BVN or payment secrets in browser local storage/mobile preferences.

## Configuration and activation

Use Paystack defaults for `KYC_PROVIDER` and `BANKING_PROVIDER_PRIMARY`; keep fallback empty. New Paystack server configuration: `PAYSTACK_SECRET_KEY`, optional validated preferred DVA bank, and allowlisted client callback/return URLs using existing application origins where possible. Use the fixed official `https://api.paystack.co` origin. A public key is needed only if the final checkout implementation uses a client integration; hosted initialization does not require it in the client.

Reject test keys in production, missing live credentials for enabled capabilities, unsafe callback URLs and unsupported providers. Remove Monnify credentials as a dependency for new Paystack-only deployments. Existing deployments retain legacy reconciliation credentials until their obligations are drained.

Expose configuration readiness separately from provider-tested readiness and observed webhook delivery. A key's presence is not evidence that DVA or transfers are enabled. Add a read-only operator diagnostic for authenticated API connectivity, available DVA providers and balance access without initiating any payment or identity check. Capabilities that cannot be proven through read-only calls remain unconfirmed until an authorized controlled acceptance test.

Update `.env.example`, production manifests, deployment validation, health checks, setup-secrets instructions, client secret scanning, provider source of truth, AGENTS provider policy and launch documentation together.

The remaining external activation steps are: configure the deployed HTTPS webhook in the Paystack dashboard, confirm merchant eligibility/product access, confirm payout approval settings and ensure the Paystack balance can cover transfers and fees. These cannot be completed by adding an API key to source code. Do not request or paste live keys into chat; use the deployment secret store.

## Delivery sequence and acceptance

1. Add provider boundary, persistence migration, configuration and readiness; preserve existing records and pending work.
2. Implement Paystack API adapter and signed inbox routing with fixtures and failure tests.
3. Implement asynchronous KYC, manual upgrades and recoverable DVA preparation.
4. Implement checkout, verified deposit allocation, beneficiaries, withdrawals and reconciliation.
5. Refactor website/Flutter/admin journeys and capability types; update operational documentation and manifests.
6. Run focused financial regression suites, backend build/lint, relevant web checks, Flutter analyze/tests and desktop/mobile visual review. Use isolated test data, never the production database for automated tests.

Required scenarios: invalid signature, raw-body tampering, malformed payload, wrong environment, wrong owner/currency/amount, duplicate and concurrent webhook/callback credit, duplicate provisioning, customer validation delay/failure, stale identification callback, account preparation retry, unverified manual evidence, insufficient/concurrent withdrawal balance, ambiguous transfer submission, terminal failure refund, authenticated reversal and replay, legacy pending Monnify reconciliation, checkout cancel/resume and unavailable Paystack capability.

Completion means the repository's automated checks pass for the changed paths, all three clients reflect the same truthful state, and a repeatable test-mode acceptance path is documented. Live processing remains unverified until credentials and merchant permissions are present and an authorized low-value end-to-end acceptance test confirms onboarding, DVA funding and withdrawal.

## Official documentation checked

- [Customer validation](https://paystack.com/docs/identity-verification/validate-customer/)
- [Customer API](https://paystack.com/docs/api/customer/)
- [Dedicated virtual accounts](https://paystack.com/docs/payments/dedicated-virtual-accounts/)
- [Dedicated virtual account API](https://paystack.com/docs/api/dedicated-virtual-account/)
- [Verify bank account number](https://paystack.com/docs/identity-verification/verify-account-number/)
- [Webhooks](https://paystack.com/docs/payments/webhooks/)
- [Payment verification](https://paystack.com/docs/payments/verify-payments/)
- [Single transfers](https://paystack.com/docs/transfers/single-transfers/)
- [Transfer lifecycle and approval](https://paystack.com/docs/transfers/how-transfers-work/)

The documentation has inconsistent sample BVN lengths and alternate assignment-event wording in some sections. Treat Nigerian BVNs as eleven digits, use the documented event table with captured provider fixtures for verification, and never ship invented endpoint/event assumptions to compensate for inconsistent examples.

## Builder check decisions

Self-critique before execution: the original design described too many capabilities without fixing the API contracts, and its optional manual-upgrade language could strand every new user below the withdrawal tier. Execution must include a real manual submission route, not just upload links; durable provider-customer and account-request records; retry-safe identity correlation; an explicit hosted-checkout recovery route; and per-capability availability. Keep legacy obligations operational while refusing new Monnify provisioning. Provider API failures must never be interpreted as a financial failure without evidence. These are acceptance requirements, not follow-up suggestions.

The design review identified the following implementation boundaries. These are proposed builder choices within the agreed migration scope:

- Existing users enroll in Paystack when they next request the new funding account and give the necessary consent; there is no background mass submission of BVNs. Their Monnify account remains labeled as an existing account. Prefer an active Paystack account for new transfers once it is ready. Preserve genuine incoming legacy deposits until the old account is confirmed disabled. An operator may retire legacy credentials only after unresolved transfers, inbox events, exchange allocations and reconciliation exceptions are cleared and existing receiving accounts have confirmed closure or an approved continuing reconciliation arrangement.
- Start the application with individual unavailable capabilities gated. Report degraded provider readiness rather than treating the entire application as healthy or crashing unrelated features. Production rollout acceptance still requires the enabled launch capabilities to pass end-to-end checks. A configured secret does not remove an availability gate.
- Reject a second identification submission while its predecessor is pending, including when a client sends a new idempotency key. A timeout alone cannot unlock another identification attempt. Use definitive provider evidence or an audited support decision to resolve ambiguous attempts before retry; never create another Paystack customer merely to bypass ambiguity.
- Preserve the existing Nigerian Tier 2 combination: a verified BVN and a separately verified NIN. The NIN decision uses the manual evidence workflow and records reviewer, evidence and reason. A typed number or document upload alone is insufficient evidence. No extra identity-document combination is invented by this migration; the reviewer must reject or hold evidence they cannot validate. Other existing document combinations remain governed by their existing policy.
- Target automated payouts with the merchant's Paystack approval settings explicitly configured for that mode by the operator. Do not change those settings programmatically. If Paystack nevertheless returns `otp` or `received`, keep the withdrawal pending, alert authorized operations and direct approval/rejection through Paystack's merchant controls; customers must never receive a merchant-OTP input. A custom TRUSTPAY merchant-approval endpoint is outside this migration. Reconcile abandonment or rejection before releasing funds.
- The current globally unique `WebhookLog.reference` is not suitable for customer identification and DVA lifecycle audit records. Make audit-log event identity provider-aware and event-aware in an additive migration, preserving existing records and financial reference uniqueness elsewhere. Retain payload-hash uniqueness in the durable inbox so legitimate changed events are not discarded, and make domain completion idempotent independently of the audit log.

Baseline verification before implementation: the focused banking, withdrawal, withdrawal-reconciliation, payment-webhook-processor and KYC-service Jest suites passed (5 suites, 47 tests). These results establish the starting behavior; they do not verify Paystack integration.
