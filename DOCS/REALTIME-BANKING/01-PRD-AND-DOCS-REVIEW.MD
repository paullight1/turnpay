# PRD And Existing Docs Review

> Historical review. Provider comparisons below are not implementation guidance; Monnify is the sole active banking/payment provider.

## Review Result

The banking PRD is directionally solid for a wallet-first fintech phase. It matches the current TRUSTPAY architecture: NestJS, Prisma, PostgreSQL, Redis, wallets, transactions, KYC, payments, webhooks, and admin.

The main risk is not feature coverage; the main risk is operational precision. Banking work needs stronger status lifecycle, provider event storage, ledger entries, admin confirmation panels, and reconciliation before launch.

## Current App Coverage

Already covered:

- User auth, JWT guards, refresh tokens, roles.
- Wallets for `NGN` and `GHS`.
- Transactions with `PENDING`, `SUCCESS`, `FAILED`, `REVERSED`.
- Paystack and Flutterwave providers.
- Webhook controllers with signature verification patterns.
- Admin user and transaction views.
- KYC review.
- Redis-backed idempotency interceptor.

Not yet covered:

- Virtual account model and user account assignment.
- Bank beneficiary model.
- Immutable ledger entries.
- Provider event store for webhook replay safety.
- Withdrawal transfer attempts and provider status history.
- Admin confirmation queue for sensitive actions.
- Reconciliation report model and dashboard.
- Risk review queue and transaction hold/release workflow.
- Customer-facing copy rules for provider bank names.

## Provider Assumption Review

Paystack:

- Dedicated Virtual Accounts are a good first path for NGN and possibly GHS, subject to go-live, business eligibility, and provider support.
- Financial services businesses may need identity validation before DVA generation.
- Paystack transfer webhooks should be treated as authoritative final status events, but provider verification must also exist for stale pending transactions.

Flutterwave:

- Useful as fallback or country/currency expansion provider.
- Virtual account deposits and payout transfers must be separated in code and admin UI.
- `charge.completed` deposit events must never be confused with transfer completion.

Mono/Okra:

- Not required for wallet-first money movement.
- Add later only for bank statements, external account insight, identity enrichment, risk scoring, or account-to-account payment initiation.

## Critical Corrections Before Implementation

- The existing PRD correctly warns not to promise "TrustPay Bank"; keep this in all UI copy and support scripts.
- The current webhook plan must explicitly split deposit events from payout events.
- Withdrawal handling must move from direct status update to a transfer-attempt lifecycle.
- Admin status edits must not be generic. Admins should verify, retry, hold, release, reverse, or escalate through typed actions.
- Reconciliation must exist before production launch, not after.

## Documentation Gaps To Close During Build

- Add API contracts before frontend starts.
- Add operational runbooks before provider sandbox testing.
- Add incident response checklist before live provider credentials.
- Add user-facing copy guide for account names, virtual accounts, pending transfers, failed withdrawals, and reversals.
