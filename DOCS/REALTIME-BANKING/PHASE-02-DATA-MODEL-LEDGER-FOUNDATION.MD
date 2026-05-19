# Phase 02: Data Model And Ledger Foundation

## Goal

Create the database and service foundation needed for safe money movement before any provider or user-facing banking feature is implemented.

## Owners

- Primary: `trustpay-ledger-backend-engineer`
- Reviewers: `trustpay-security-risk-engineer`, `trustpay-reconciliation-qa-engineer`, `trustpay-data-privacy-engineer`

## Planned Models

- `VirtualAccount`
- `BankAccount`
- `LedgerEntry`
- `ProviderEvent`
- `TransferAttempt`
- `AuditLog`, if existing admin audit support is insufficient.

## Work Items

- Add enums for provider, provider event status, transfer attempt status, ledger direction, and account status.
- Add encrypted or masked account-number storage strategy.
- Add indexes for user, reference, providerReference, status, and createdAt.
- Add service helpers for Decimal-safe balance movements.
- Add state transition helpers for transaction and transfer attempts.
- Add provider event deduplication storage.

## Tests

- Decimal precision tests.
- Duplicate provider reference tests.
- Concurrent balance update tests.
- Ledger before/after balance tests.
- Account-number masking tests.

## Acceptance Criteria

- Money movement has a single transaction boundary.
- No negative balances are possible.
- Provider events can be replayed safely.
- Sensitive account data is masked in reads and logs.

## Implementation Status

Status: `IMPLEMENTED FOR DEPOSIT FOUNDATION`

Implemented in backend:

- Added Prisma models/enums for `LedgerEntry`, `VirtualAccount`, `BankAccount`, `ProviderEvent`, `TransferAttempt`, and `AuditLog`.
- Added database constraints for positive ledger amounts and non-negative wallet balances.
- Added `LedgerService` to centralize wallet credit/debit mutations and append ledger entries with balance before/after.
- Added account-number masking and provider-payload redaction helpers.
- Added focused tests for positive amount enforcement, overdraft prevention, balance before/after recording, and missing wallet handling.

Remaining for later phases:

- Refactor existing payment-link deposits, withdrawals, exchange, and VTU flows to use `LedgerService`.
- Add durable database-backed idempotency records if Redis-only idempotency is not enough for production.
- Update reconciliation to derive balances from `LedgerEntry` instead of `Transaction.type`.
- Add maker-checker admin action enforcement for high-risk money operations.
