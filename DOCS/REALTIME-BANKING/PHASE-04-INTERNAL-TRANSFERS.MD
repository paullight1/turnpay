# Phase 04: Internal TRUSTPAY Transfers

## Goal

Let users send money instantly to other TRUSTPAY users using internal wallet balances.

## Owners

- Primary: `trustpay-ledger-backend-engineer`
- Reviewers: `trustpay-security-risk-engineer`, `trustpay-reconciliation-qa-engineer`, `trustpay-frontend-mobile-engineer`

## Backend APIs

- `POST /transfers/internal`
- `GET /transfers/internal/:reference`
- Recipient lookup endpoint, if product approves lookup by phone/email/handle.

## Work Items

- Define recipient lookup rules and privacy-safe responses.
- Enforce KYC, suspension, balance, currency, amount limits, and idempotency.
- Debit sender and credit recipient inside one Prisma transaction.
- Create sender and recipient transaction records.
- Create ledger entries for both wallets.
- Notify both users after success.

## Tests

- Successful transfer updates both balances.
- Duplicate request returns original response.
- Concurrent transfers cannot overdraw wallet.
- Suspended sender cannot send.
- Transfer to self is rejected.
- Invalid recipient lookup does not leak private user data.

## Acceptance Criteria

- Internal transfer is atomic.
- Both users have clear transaction history.
- No provider dependency exists for internal transfers.

## Implementation Status

Status: `IMPLEMENTED FOR BACKEND SERVICE/API FOUNDATION`

Implemented in backend:

- Added `TransfersModule`, `TransfersController`, `TransfersService`, and `InternalTransferDto`.
- Added authenticated and throttled APIs:
  - `POST /api/transfers/internal`
  - `GET /api/transfers/internal/:reference`
- Supports exact recipient identifiers by one of `recipientId`, `recipientEmail`, or `recipientPhone`.
- Enforces exactly one recipient identifier.
- Enforces sender verified KYC, sender suspension gate, recipient verified KYC, recipient suspension gate, non-self transfer, supported currency, and positive amount.
- Debits sender and credits recipient through `LedgerService` inside one Prisma transaction.
- Creates one outbound `Transaction` for sender and one inbound `Transaction` for recipient, linked by shared `transferReference`.
- Creates sender `DEBIT` and recipient `CREDIT` ledger entries through the ledger service.
- Hardened ledger debit path with a conditional `balance >= amount` update to reduce concurrent overdraft risk.
- Returns masked recipient data to the sender instead of raw recipient email/phone.
- `GET /api/transfers/internal/:reference` returns sanitized receipt data instead of raw transaction metadata.
- Added focused tests for successful transfer, KYC gate, suspended recipient privacy-safe failure, self-transfer rejection, unknown recipient, exactly-one-recipient validation, and sanitized reference lookup.

Security and UX decisions:

- Internal transfers are provider-independent and should normally complete as `SUCCESS` or fail with no wallet movement.
- Recipient-blocked states return privacy-safe recipient errors; the sender should not learn if a recipient is suspended or unverified.
- The global idempotency interceptor requires `Idempotency-Key` for `POST /api/transfers/internal`.

Remaining for later hardening:

- Add E2E tests for `Idempotency-Key`: missing key `400`, duplicate response replay, and in-flight conflict `409`.
- Add real Postgres concurrency tests for two simultaneous near-full-balance transfers.
- Add a short-lived recipient lookup token flow before frontend/mobile production UX.
- Add configured daily/monthly/velocity limits and AML review states.
- Add admin/risk audit events for blocked transfer attempts and high-risk transfer patterns.
