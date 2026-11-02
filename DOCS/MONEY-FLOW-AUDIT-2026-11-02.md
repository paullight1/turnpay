# Money-flow audit — 2 November 2026

> Remediation follow-up: the findings below record the pre-fix audit. Implementation, regression evidence, operator instructions and deployment limits are tracked in [Money-flow fixes — 2 November 2026](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/DOCS/MONEY-FLOW-FIXES-2026-11-02.md).


## Assessment

The accounting foundation is substantially implemented, but this checkout should not receive unrestricted real-money sign-off yet. Two high-priority gaps can affect money or financial exposure; five medium-priority gaps affect credential protection, recovery and reconciliation. This was a review: no application fixes, identity approvals, financial transactions, deployments or Git pushes were performed.

The reviewed boundary is the current shared checkout, including its uncommitted changes. Coverage includes wallet/ledger writes, Paystack funding and withdrawals, legacy Monnify obligations, internal transfers/reversals, wallet and manual exchange, gated Kora services, VTpass purchases/reversals, KYC/PIN requirements, durable webhook processing, reconciliation, Flutter recovery and the admin payout queue. This is not a regulatory certification or an exhaustive infrastructure/penetration assessment.

## Findings, in priority order

### F1 — High: a post-commit idempotency failure permits another withdrawal or VTU purchase

**Evidence:** [IdempotencyInterceptor](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/common/interceptors/idempotency.interceptor.ts:252), especially its catch/delete at line 277; [withdrawal reference creation](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/payments/payment.service.ts:160); [VTU reservation](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/vtu/vtu.service.ts:326).

The handler can finish its financial operation, after which the interceptor saves the response in PostgreSQL and Redis. A failure at either persistence boundary enters the generic transient-error catch, which deletes the idempotency record—even if it was already marked completed. A process crash between the financial commit and response persistence has the related problem once the lease is reclaimed. Withdrawal and VTU handlers generate a new reference on each execution and do not atomically bind the supplied idempotency key to their reservation.

**Reproduced offline:** a simulated Redis cache-write failure after handler success removed the durable replay record. A retry with exactly the same user, route, body and key invoked the real interceptor's handler a second time and returned a second reference. No real withdrawal was made. Real Redis failures throw outside the explicit development/test memory-fallback mode, so this is not limited to the fake adapter's behavior.

**Impact:** a lost response or cache outage can turn a retry into a second debit/payout or second airtime/bill purchase, when sufficient balance remains. Existing provider and ledger uniqueness only protect one reference/transaction, not two newly generated ones. Internal transfers and manual exchange have stronger business-level database bindings and are not the primary affected routes.

**Required change:** atomically persist a unique user/key/business fingerprint with each withdrawal/VTU reservation; always recover its original reference. Make response caching best-effort, never delete a completed operation's replay record, and distinguish a definitely unstarted operation from an unknown committed outcome. Test cache failure, acknowledgement loss, worker death after commit and concurrent same-key recovery at the HTTP + database boundary.

### F2 — High: Paystack dispute/refund events are acknowledged without a financial workflow

**Evidence:** [Paystack event routing](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/payments/webhooks/payment-webhook.processor.ts:140), unhandled return at line 187, and the completion path at line 64. [Checkout initialization](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/payments/paystack-funding.service.ts:160) does not restrict channels; actual available channels depend on merchant settings.

The router handles successful charges, transfers, identity and dedicated-account events. It does not handle `charge.dispute.create`, `charge.dispute.resolve` or `refund.processed`. These events return `ignored`, after which the inbox is completed and the webhook log is marked processed. The existing customer support/dispute records do not implement a Paystack chargeback settlement path.

**Reproduced offline:** all three event types completed as `Unhandled Paystack event`, with logs marked processed and no financial handler called. Paystack documents these as real supported events: [official event list](https://paystack.com/docs/payments/webhooks/).

**Impact:** if a credited funding payment is refunded or disputed externally, TrustPay has no corresponding wallet hold, exposure record, receivable or reviewed compensation. Card-funded cash-out exposure is especially relevant where card funding is enabled. This audit did not establish that a real refund or chargeback has occurred, or inspect merchant channel settings.

**Required change:** add idempotent event correlation and independent provider verification, dispute cases and spending/exposure controls. Resolve against the original funding reference with an audited accounting policy. Do not blindly deduct into a negative wallet or automatically treat every dispute as a lost chargeback. Until that exists, explicitly choose and enforce the permitted funding-channel policy.

### F3 — Medium: the request digest offers a fast offline PIN-guessing check

**Evidence:** [request hashing](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/common/interceptors/idempotency.interceptor.ts:336) hashes the entire JSON body with unkeyed SHA-256, including `transactionPin`. The digest is stored in the idempotency record/cache. In contrast, [internal-transfer fingerprinting](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/transfers/internal-transfer-idempotency.service.ts:36) hashes business fields without the PIN.

**Reproduced offline:** given a synthetic request's nonsecret fields and saved request hash, enumerating four-digit PINs recovered the matching synthetic PIN in 2,469 guesses. No real PIN, digest or account record was read for this probe.

**Impact:** disclosure of request digests plus known request fields can undermine the stronger protection of the actual PIN credential. This is conditional on access to stored digests and enough request information; it is not evidence of a remote credential compromise.

**Required change:** separate business replay fingerprints from authentication secrets. Exclude financial PIN/OTP fields from business fingerprints while retaining authentication at first execution. Where credentials must bind a sensitive auth replay, use a reviewed keyed construction and server-held secret rather than a fast unkeyed password/PIN oracle. Preserve auth replay protections; do not indiscriminately remove credentials from login semantics.

### F4 — Medium: a delayed VTU response can overwrite a confirmed terminal order

**Evidence:** [unknown-result write](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/vtu/vtu.service.ts:1042), [pending-result write](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/vtu/vtu.service.ts:1067), and [terminal requery handling](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/vtu/vtu.service.ts:719).

If the signed callback/requery finalizes a purchase while the original provider HTTP request is still in flight, the original request can later return pending or throw. Both result-marker methods update the order by ID without requiring an unresolved state. They overwrite `SUCCESS` with `PENDING` or `UNKNOWN`, while the transaction remains successful. A later requery sees the successful transaction and returns early without repairing the order.

**Reproduced offline:** both paths changed an already-successful order back to an unresolved state. A subsequent successful provider requery left that inconsistent state unchanged.

**Impact:** fulfilled purchases can continue to look unresolved, conflicting across receipts/history and potentially encouraging another purchase. The examined terminal transaction guards prevent this probe from causing another refund; the confirmed defect is status/metadata regression and incomplete recovery.

**Required change:** use a shared, transactional state transition for initial responses and callbacks. Guard unresolved writes with the transaction/order's current status; terminal evidence wins. A verified requery should repair any existing order/transaction disagreement. Add real concurrency tests for success-before-pending, success-before-timeout and failure-before-late-initial-response.

### F5 — Medium: manual payout claims have no supported operator handover

**Evidence:** [manual state machine](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/exchange/manual-exchange.policy.ts:59), [owner restriction](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/exchange/manual-exchange.service.ts:681), and [admin queue messaging](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/WEBSITE/src/app/admin/exchange/manual-orders/page.tsx:1332).

Once an operator claims an external payout, only that operator can upload/record the payment. The only permitted actions from `PAYOUT_PROCESSING` are mark sent or record cedis sent. There is no release, supervised reassignment or recovery action. The UI explicitly says the original owner must continue.

**Validated:** enumerating every permitted action through the actual policy returns only `MARK_SENT` and `RECORD_CEDIS_SENT`; service and UI inspection confirm the owner constraint.

**Impact:** an absent, disabled or unavailable operator can strand an already-funded order. A genuinely failed external payout also needs an explicit operational resolution, rather than a database edit or an invented successful receipt.

**Required change:** add a narrowly authorized, audited supervisor handover after checking the real bank/MoMo outcome, with clear evidence and one active owner. Provide a reviewed exception/refund route for collected money where payout cannot be completed. Never automatically expire a claim and send again: the first operator may already have paid externally.

### F6 — Medium: VTU automatic recovery stops without an explicit exhausted-work state

**Evidence:** [requery selection](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/vtu/vtu.service.ts:662) excludes orders at 12 attempts; [customer GET status](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/vtu/vtu.service.ts:789) only reads local data. The explicit POST requery and admin tools do remain available. The admin reconciliation report initially selects the latest limited batch before assessing stale orders ([report query](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/admin/admin.service.ts:1731)).

After repeated provider failures, an unresolved order can retain its debit and pending/unknown presentation while automatic polling stops. No transition/notification at the retry threshold was found in this path. Under normal five-minute scheduling this can occur after roughly an hour, though scheduling and manual checks alter the timing.

**Impact:** recovery becomes dependent on a customer/admin explicitly requesting another provider check. Older exceptions can also fall outside the report's latest-order sample. This is a recovery/operations gap, not evidence that all manual recovery is missing.

**Required change:** introduce an explicit action-required exception queue, age/attempt alerts, and a supervised retry policy with backoff. Query unresolved exceptions directly rather than treating a sample of recent orders as a complete reconciliation. Keep funds reserved until genuine provider evidence or an authorized resolution; do not refund merely because a retry count was reached.

### F7 — Medium: wallet reconciliation accepts a one-minor-unit mismatch

**Evidence:** [reconciliation threshold](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/BACKEND/src/common/services/reconciliation.service.ts:601) only flags a difference greater than `0.01`.

**Reproduced offline:** a ledger total of `100.00` and wallet balance of `99.99` produced zero mismatches. Stored wallet and ledger amounts are already exact two-decimal values, so this path does not need that tolerance for floating-point noise.

**Impact:** one kobo/pesewa of unexplained difference per wallet is silently treated as reconciled. This weakens early detection of drift across many wallets.

**Required change:** compare exact minor units and flag every nonzero difference. If any specific rounding account is intentional, represent it explicitly rather than hiding it in a per-wallet tolerance. Test positive/negative one-minor-unit differences and exact equality.

## What is working in the reviewed scope

| Area | Evidence and practical boundary |
| --- | --- |
| Wallet writes | Source search found increment/decrement mutations centralized in LedgerService. Guarded debit checks prevent insufficient balance, transactions join ledger and wallet updates, and transaction/source uniqueness prevents duplicate postings for one operation. This does not solve F1's second-operation problem. |
| Internal transfers | Durable business idempotency, both legs in one transaction, currency/tier limits, PIN-reset holds, independent reversal approvals and insufficient-recipient-balance handling are exercised by the isolated financial tests. |
| Paystack funding | Initialization binds a stable reference to user/key; receipt verification checks environment, currency, amount and customer binding; ledger credit is guarded and atomic. A genuine later success may correct a previously failed incoming checkout exactly once. F2 covers subsequent refund/dispute exposure. |
| Paystack withdrawals | Debit/reservation is transactional; payout confirmation verifies reference, environment, amount, currency and recipient. Unknown outcomes remain pending and confirmed failure/reversal restores funds once. F1 remains a release blocker. |
| Manual exchange | Independent admin rates; frozen quote terms; single allocation of deposit references; receipt ownership; exact received/payout amounts; operator ownership; protected proof and audit trail. GHS→NGN credits the NGN wallet; NGN→GHS records an admin's actual external payout. F5 covers exceptions after claiming. |
| Wallet exchange | The backend has an atomic wallet-debit/credit path with a unique quote ID, expiry and a claim guard. The customer manual flow is a separate external-payment product; it does not automatically debit an existing NGN/GHS wallet. |
| VTU | Server-priced packages/fees, expected-total validation, NGN wallet debits, PIN/KYC, verified requery on callbacks and guarded compensation are present. F4/F6 cover asynchronous recovery gaps. |
| KYC and access | Protected routes use JWT/admin roles; money movement generally requires Tier 2. Funding/deposit eligibility starts at Tier 1; Paystack DVA preparation additionally depends on provider validation/consent. NIN remains a human-reviewed evidence flow. |
| Reconciliation | Wallet-ledger snapshots and product checks exist, with persisted holds and audited clearance. These internal checks alone do not establish merchant/bank asset backing; external statements, fees, outstanding settlements and provider balances still need operational reconciliation. |

## Current environment and product gaps

Read-only checks against the database configured by the local backend found Paystack selected in live mode, manual exchange enabled, Ghana automation disabled, and both rate pairs sourced from admin without an expiry. **No rate values were changed or reinterpreted.**

That database had 12 wallets, zero ledger entries, no manual exchange orders and no payment webhook inbox rows. It also had a pending Paystack identity attempt and a pending manual-review identity record. These facts are limited to this connected environment; they do not establish the state of every production deployment or merchant dashboard. They provide no evidence yet of a completed settled live flow.

Before a broader launch:

- Complete genuine Paystack BVN processing and authorized NIN review. A 202 acceptance must remain pending; do not bypass Tier 2 to make tests pass.
- Make the source of exchange money explicit before the user enters details: **existing wallet balance** versus **new external transfer**. The present manual screen creates external transfer instructions, not an automatic debit of a customer's virtual account. Connect the separate wallet path deliberately if both products are intended.
- Keep Ghana automation labeled unavailable until merchant activation, provider approvals, balances and genuine collection/payout callbacks are proven. Passing Kora adapter tests does not activate Kora.
- Show unresolved attempt reference, receipt/fulfillment result, fees, expected timing and next support action consistently. Avoid offering a replacement transaction while the original outcome is unknown.
- Reconcile provider statements, settlement charges, bank/MoMo payments and customer liabilities. The customer-wallet ledger is not by itself a full double-entry asset/clearing/fee accounting system.

## Verification and limits

Fresh checks during this audit:

- **686 backend unit tests / 94 suites passed.**
- **65 isolated PostgreSQL/Redis financial tests / 10 suites passed.** These exercise real database/Redis concurrency with fake external-provider/auth/storage boundaries, not live payments.
- **426 Flutter tests passed.**
- Backend production-scope TypeScript and web TypeScript checks passed without emitting/rebuilding the running backend.
- Six categories of offline source-based probes reproduced the findings above; the VTU probe covers both pending and timeout response races. Results: `.superpowers/sdd/2026-11-02-money-flow-audit/reproduce.json`. These probes intentionally demonstrate remaining defects; passing existing suites does not dismiss them.

The first financial run lacked the dedicated test Redis setting: 63 tests passed and two failed setup. A fresh isolated Redis instance and full rerun passed all 65. The first full app attempt hit a temporary no-space compiler failure and was not accepted as a passing run; the fresh rerun completed with all 426 tests. No unrelated files were deleted to make the tests pass. An initial read-only metadata query requested the wrong rate-date field, failed validation and was corrected; it made no database mutation.

The audit did not create a real charge, transfer, exchange order, wallet posting, refund, document decision, permission grant or provider event replay. It did not certify live callback delivery, merchant channel settings, liquidity, settlement statements, Android production transport policy or production deployment parity. Existing internal-testing transport exceptions remain internal-testing exceptions.

## Recommended execution order

1. Fix F1 and F2 before unrestricted money movement or refundable funding is enabled.
2. Fix F3 and F4, then repeat post-commit fault and callback-ordering tests at the HTTP/database boundary.
3. Add F5/F6 exception ownership and alerts; tighten F7's exact reconciliation.
4. Run a supervised, low-value live acceptance matrix: funding → exactly-one credit; transfer/withdrawal success and failure; both manual exchange directions; VTU fulfillment/token receipt; missed/duplicate callback recovery. The account owner must explicitly authorize and perform the real financial actions. Match ledger, provider and bank/MoMo evidence before sign-off.

Audit conclusion: the implemented controls and passing tests are a useful foundation, but the new fault probes reveal coverage gaps. Close the listed risks and prove the live settlement paths before treating the product as fully ready.
