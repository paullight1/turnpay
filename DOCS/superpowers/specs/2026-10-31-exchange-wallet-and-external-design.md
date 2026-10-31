# Cedi and naira exchange: wallet or external funding

Date: 2026-10-31

Status: Proposed design; funding choices confirmed, implementation approval pending.

## Intent and confirmed requirements

Make cedi → naira the first exchange option. Support naira → cedi as well. Customers enter an amount, choose where to receive money, review the amount and fee, select Withdraw and authorize with their transaction PIN. An admin is notified when funding is confirmed and authorizes the destination payout. The customer sees understandable progress and a receipt.

The customer explicitly selected existing TrustPay cedi wallet funds, then added external funding. Therefore offer both **TrustPay balance** and **Bank or MoMo transfer**. Neither funding choice may silently become the other.

Use the existing NestJS/Prisma, Next.js and Flutter implementations and design system. Preserve Tier 2 eligibility, PIN controls, suspension checks, reconciliation holds and all requirements in `DOCS/SECURITY-RULES.MD`. Preserve the extensive unrelated working-tree changes.

## Approaches

1. Wallet funding alone: simplest payment confirmation, but excludes the requested external funding option.
2. External transfers alone: builds on the existing manual orders, but requires another transfer even when the customer already has money in TrustPay.
3. Both funding sources with one journey and payout queue: the selected scope. Wallet funding confirms through an atomic debit; external funding confirms through independently verified receipt. This costs additional reconciliation and UI states but satisfies both requests without duplicate funding.

Implementation proposal: extend the existing manual-order aggregate additively for the new journey; retain historical orders and legacy wallet-conversion/payout APIs. Do not rewrite old records to look like new provider-backed payouts.

## What works today, and what changes

- Manual orders already accept NGN or GHS, freeze order terms, accept private proof, allocate a confirmed deposit once and track external settlement. Their documentation still describes the older NGN-only scope.
- Existing wallet-funded `ExchangePayout` creation hardcodes NGN → GHS. It debits a wallet transactionally but recomputes terms at submission instead of consuming the displayed quote.
- Legacy payout approval prematurely sets the parent transaction to SUCCESS. Approval must remain pending until settlement. Existing legacy records need a reconciliation report rather than a blind historical status rewrite.
- `notificationSent` is set without exchange notification delivery. Implement a durable admin inbox; do not use this boolean as delivery evidence.
- The configured Paystack banking adapter only implements Nigerian NGN recipients/transfers. It is a domestic payout leg, not an FX conversion service. No Ghana payout integration is implemented in this scope.

## Customer journey

1. **Amount.** Default to Cedis → Naira, with a clear switch for the other direction. Show large **You pay** and **You receive** values, currency names and symbols. Any amount shown before a server quote is labelled an estimate.
2. **Pay with.** TrustPay balance is the default proposal. Display the real available source-currency balance. The other choice is Bank or MoMo transfer, with transfer instructions shown only after the order exists. Insufficient wallet funds offer an explicit switch to external funding; never debit a different wallet.
3. **Receive money.** NGN goes to a verified Nigerian bank beneficiary. GHS can go to a Ghana bank or MoMo recipient using the existing manual-settlement capability. Only display available destination methods. In-app currency conversion remains a separate existing action, not another interpretation of Withdraw.
4. **Review.** Show the source principal, separately labelled fee, total to pay, exact destination amount, frozen rate, quote expiry and masked destination/name. The fee policy remains the existing configured policy; do not introduce an extra charge or alter the spread. Label an expiring quote clearly. Amount, funding source or destination changes require a fresh quote.
5. **Withdraw and PIN.** Withdraw opens the existing secure PIN authorization. The server consumes the reviewed quote and creates the order. Never persist the PIN. Preserve the same account-scoped attempt on a lost response; restore its details after restart and recover from the server before offering a new payment.
6. **Progress.** For wallet funding show Money confirmed → Waiting for admin → Sending → Sent. For external funding first show Send your cedis/naira → Checking your payment. Display the appropriate next action, reference, amount and support route. A verified failure or refund has its own honest status; an unknown provider outcome remains Checking payment.

UI proposal: bold typography for the two amounts, a single primary action per step, large touch targets, short sentences and an always-visible currency direction. Forms need labels, inline validation, keyboard focus, accessible contrast and recovery without discarding entered details. Test small phones, keyboard-open layouts, desktop, loading, empty, disabled, error and success states. Poll active records while visible and pause when hidden/disposed.

## Quotes and order contract

Add a durable, owned, expiring payout quote for the new journey. Persist source/target currencies, source amount, fee, total funding amount, rate, target amount, funding source, destination snapshot, eligibility/configuration version and expiry as decimal-safe terms. Preserve precision as strings at API boundaries. New quotes freeze the effective rate to six decimal places with ROUND_DOWN, calculate the destination amount to two places with ROUND_DOWN and the source fee to two places with ROUND_CEIL. Execution consumes these stored values without recalculation. Historical transactions retain their historical rounding and pricing. A quote cannot be used by another customer or for changed details.

Preserve the existing funding-specific fee policy: wallet-funded payouts use `(1 + markupPercent / 2)%` of source principal, separately from the exchange-rate spread; external manual orders retain their existing zero explicit fee. Quote responses identify that policy and funding source so switching methods cannot change a hidden charge. Preserve the existing positive source-amount ceiling of 10,000,000 source-currency units and apply any tighter configured corridor/eligibility limits. Do not sum raw NGN and GHS amounts into one shared currency counter.

Order creation accepts the quote ID, PIN and idempotency key, not new financial terms. Consume a quote once using a database uniqueness constraint inside the order transaction. Enforce durable uniqueness for the customer attempt and request fingerprint even after an interceptor cache loss or a post-commit response failure. Reusing a key with different business details conflicts; a valid retry returns the original order without moving money again. Different keys cannot consume the same quote twice.

Extend `ManualExchangeOrder` or its associated records additively with funding source (EXTERNAL by default for historical rows), quote association, frozen funding total, funding confirmation actor/time, payout execution method and durable transfer-attempt association. Continue reading the existing `collectionAccount` snapshot and historical event structure. New endpoints may present provider-neutral exchange orders while legacy endpoints retain their old contracts. New client entry points use the new contract consistently.

Do not create an ordinary customer withdrawal by calling `PaymentService.withdraw` from an exchange order: that would debit again. Reuse the provider boundary and applicable reconciliation infrastructure with an exchange-specific persisted attempt and settlement owner. Its link to an exchange order must be explicit and unique.

## Wallet funding and treasury accounting

Inside one database transaction, recheck eligibility/holds, consume the quote, debit source principal plus fee with the existing conditional ledger operation, record the funded exchange obligation and event, and create the admin inbox event. A competing withdrawal cannot spend those funds. An insufficient balance rolls everything back.

A virtual account is the receiving address for deposits, not the balance being spent. Deposits already credited through normal wallet funding must not also fund an external exchange order. The customer's instruction to move funds to the admin account is represented by TrustPay treasury/clearing accounting when custody is already pooled. Do not send money to an admin's personal virtual account, manufacture a provider deposit event or credit an admin consumer wallet. Any genuinely separate treasury bank sweep is independently reconciled and must never be mistaken for a second customer payment.

Record both currency legs as explicit clearing/payable obligations tied to the frozen order, with traceable source debit, fee and destination settlement. Reuse current ledger primitives and introduce additive clearing records/journals as necessary; do not imply that a wallet debit alone proves a treasury bank transfer. Reconciliation must account for funds reserved, paid, refunded and still owed, separately for each currency.

## External funding

Show only configured collection methods/accounts for the source currency, snapshot their version on creation and validate their real format. Preserve the protection against using a normal auto-crediting user virtual account as the dedicated manual collection account. Do not assume every Ghana bank/MoMo identifier uses the same format.

For GHS, retain independent operator verification against the actual collection statement until a trusted Ghana collection integration exists. A receipt upload or customer pressing I have paid only requests checking; it never confirms receipt. Require exact currency, total amount, unique provider/bank reference, receiving account and matching order. Customer proof stays private and ownership-scoped. Reject any reference already allocated to wallet funding or another exchange.

NGN external collection can use supported independently verified Paystack receipts only with an explicit exchange-order allocation and a dedicated supported collection setup. Otherwise retain the independently checked dedicated collection flow. Do not repurpose a customer's wallet-funding account silently. Never restore new Monnify activity.

Underpayment, overpayment, unmatched money and stale/ambiguous receipts stay in review. An expired quote cannot silently reprice money already received: preserve the existing explicit administrator acknowledgement to honor the original terms, or route to support for an audited resolution. New wallet orders reject expired quotes before debit. External confirmation records the reviewer and confirmed inflow exactly once; it creates the funded obligation and admin inbox event transactionally and does not also credit a customer wallet.

## Admin payment and authorization

One queue groups **Check payments**, **Ready to send**, **Sending**, **Needs attention** and **Sent**. Each row clearly shows direction, funding source, confirmed funding, destination amount/name, age and payment reference. Funding proof and outgoing payment evidence are separate.

For NGN, **Send naira** triggers the actual Paystack transfer after reviewing the frozen beneficiary and amount. Atomically claim the order and persist a stable lowercase provider reference before dispatch. Two admins, repeated clicks and different retry keys can create only one active payout attempt. Provider OTP/approval requirements remain admin-only and appear as an action-required state; do not ask the customer for a merchant OTP or change merchant security settings.

Preserve the existing manual-order authorization and claim-ownership policy for the extended aggregate: one authorized admin can release system-confirmed wallet funding, or independently verify an external receipt against the real statement and then release it. Receipt verification and payment dispatch remain distinct recorded events; uploading a screenshot does not satisfy the verification step. Do not introduce a second operator requirement for the existing manual-order path. Existing legacy `ExchangePayout` approver/settler separation remains enforced; new clients use the extended order contract without silently reclassifying those old obligations.

For GHS, retain the existing assigned-operator manual payout with a truthful **Record payment sent** action, actual unique outgoing reference and verified private payment evidence. Do not label an audit/status update Send cedis or pretend it calls a Ghana payment provider. Automatic one-action cedi disbursement remains unavailable until a supported Ghana merchant/payout integration has been configured and accepted. Both directions can still be processed through their available settlement method.

Never mark the parent transaction successful at approval or dispatch. A provider success, independently verified against the persisted reference, destination, exact amount and currency, completes NGN settlement. Manual GHS settlement retains separate sent and verified-complete steps. Every transition records actor, time, reference and reason; account identifiers and secrets must not leak to ordinary logs.

## Failures, recovery and reversal

Persist the outgoing attempt before contacting the provider. Do not hold a database transaction open across an external HTTP request. Recovery requeries that same reference; it cannot create a fresh payment while the first outcome is uncertain. Persist claim/dispatch state so a worker crash before or after dispatch is recoverable without assuming that claim expiry means no payment occurred.

Authenticated webhooks enter the existing durable inbox after signature and DTO validation. Route exchange transfers to their persisted exchange attempt rather than the customer-withdrawal handler. Compare the amount, currency, recipient and reference against server records. Duplicate, stale, unknown or mismatched events cannot overwrite success, complete another order or issue another refund. Reconciliation queries provider status when event evidence is insufficient.

Confirmed terminal failure of a wallet-funded payout restores the original source debit/fee according to the existing refund policy exactly once, together with the state transition and compensating ledger event. A timeout, missing response or temporarily not-found provider reference never refunds. A confirmed reversal after success follows the repository reversal rules and records one compensating movement. External funding has no original wallet debit to reverse: hold the customer obligation for an audited retry/refund resolution and never invent a wallet refund. Preserve separately the source amount owed and destination payout state.

## Notifications

Create a persistent admin inbox item in the same transaction as funding confirmation. Give it a unique order/event identity so retries cannot create another item. Expose an authenticated, authorized admin inbox/count with a link to the order; polling is sufficient for the first implementation and requires no external push credentials. Mark read separately from created/delivered. An order becomes visible in Ready to send even if a later notification transport fails.

Customer status changes are durable on the order timeline. Any optional email/push work uses an outbox, explicit delivery state and bounded retries; it is not required to deliver the initial in-product notifications and must not be reported as sent without evidence. Do not expand this work into replacing the unrelated rate-alert stub.

## Scope, rollout and evidence

Implement the cedi → naira wallet and external funding paths first, with real NGN payout initiation. Then expose the reverse corridor with both NGN wallet and external NGN funding through the same customer UI while preserving its honest manual GHS settlement. One-action provider dispatch in this design applies to the NGN payout leg; the GHS leg remains manual because no Ghana disbursement adapter is implemented. This limitation must be visible in the design approval summary. Existing wallet-only conversion, historical manual orders and legacy obligations remain readable and correctly reconciled. No schema reset, provider credential change, production money movement or deployment is included in implementation approval.

Ghana external funding supports whichever dedicated bank and/or MoMo channels have been configured and independently checked; both are optional capabilities, not a promise that two live channels are available. Authoritative evidence is the receiving institution's actual merchant statement/payment history with a unique reference, not a customer image. Account/statement access is operational configuration; absent usable access, external GHS creation stays unavailable while wallet funding can remain available. There is no need to select a new Ghana API provider to build the manual verification path.

For an expired external order, the default action remains blocked. An authorized reviewer can explicitly acknowledge and honor the original frozen terms after verifying receipt, using the existing acceptance control and audit reason. If TrustPay cannot honor those terms, route the existing obligation to audited support resolution; never choose new terms automatically.

Use additive migrations and server capabilities for funding methods, collection readiness and payout methods. Configured credentials do not establish live readiness. New flows remain disabled per corridor until collection access, treasury liquidity, merchant transfer approvals and settlement/reconciliation acceptance are demonstrated in staging. Historical reads and obligation resolution must remain possible when new creation is disabled.

Required regression evidence: frozen quote/fee parity, decimal boundaries, expired/wrong-owner/wrong-currency quotes, duplicate keys with lost responses, different keys for the same quote, simultaneous debits, insufficient funds, no negative balance, exactly one treasury obligation, external-reference collision with wallet funding, duplicate/manual confirmation, short/overpaid deposits, concurrent admin sends, approval without premature SUCCESS, provider pending/OTP/unknown/failure/success/reversal events, webhook replay and out-of-order delivery, crash recovery, exactly-once refunds, private evidence access, admin separation, and durable notification creation.

Run meaningful unit/API/client tests and financial integration tests against an explicitly disposable financial test database. The initial review passed 42 targeted backend tests, but those do not cover the complete proposed flow. No disposable financial E2E database was configured in the review environment. Verify Flutter and web layouts at small phone and desktop sizes, with loading/errors, keyboard-open forms and ambiguous-network recovery. Record unverified live-provider acceptance as outstanding rather than claiming production readiness.

Builder choices: exact component boundaries, additive schema names, internal adapters, indexes, inbox polling mechanism and visual spacing can follow established project patterns. Funding semantics, frozen terms, settlement evidence, existing administrator/claim controls and unsupported Ghana automation are design constraints, not silent implementation choices.
