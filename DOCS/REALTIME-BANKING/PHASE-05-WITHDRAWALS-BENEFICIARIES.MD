# Phase 05: Withdrawals And Beneficiaries

> Archived plan. Use the Monnify-only flow documented in `DOCS/PRODUCTION-GUIDES/05-WITHDRAWALS.MD`.

## Goal

Allow users to save bank beneficiaries and withdraw wallet balances to external bank accounts through provider transfer rails.

## Owners

- Primary: `trustpay-payments-architect`
- Reviewers: `trustpay-ledger-backend-engineer`, `trustpay-security-risk-engineer`, `trustpay-admin-ops-engineer`, `trustpay-data-privacy-engineer`

## Backend APIs

- `GET /banking/banks`
- `POST /banking/banks/resolve`
- `POST /banking/beneficiaries`
- `GET /banking/beneficiaries`
- `DELETE /banking/beneficiaries/:id`
- Refactor `POST /payments/withdraw`
- `GET /payments/withdrawals/:reference`

## Work Items

- Resolve account names through provider before saving beneficiary.
- Store account numbers encrypted and expose masked values only.
- Create withdrawal transaction and transfer attempt.
- Debit wallet only through transactional service.
- Treat provider timeout as pending.
- Process transfer success/failure webhooks.
- Reverse failed withdrawal exactly once.

## Admin Work

- Show pending withdrawals.
- Show transfer attempts.
- Allow admin verify/retry from provider.
- Allow hold/release where risk rules require review.

## Tests

- Bank resolve validates input and provider result.
- Duplicate withdrawal request does not double debit.
- Provider failure reverses exactly once.
- Provider timeout remains pending.
- Transfer success marks withdrawal successful.
- Deleted beneficiary cannot be used.

## Acceptance Criteria

- User cannot withdraw more than available balance.
- Failed provider transfer never leaves wallet permanently debited.
- Admin can investigate every pending or failed withdrawal.

## Implementation Status

Status: backend foundation implemented, provider finalization/admin operations still pending.

Completed in this phase:

- Added beneficiary APIs under `/banking`: list banks, resolve bank account, create beneficiary, list beneficiaries, and soft-delete beneficiary.
- Saved beneficiary account numbers are encrypted at rest and returned only as masked account numbers.
- Beneficiary creation requires a verified, non-suspended user.
- Refactored `POST /payments/withdraw` to support saved `beneficiaryId` withdrawal destinations.
- Withdrawal now requires a verified, non-suspended user and validates withdrawal limits before provider initiation.
- Withdrawal debits and failure reversals now go through `LedgerService`; the old direct wallet balance mutation path was removed from the active flow.
- Withdrawal transaction and transfer attempt metadata stores masked destination details only.
- Added `GET /payments/withdrawals/:reference` for masked withdrawal status and transfer-attempt inspection by the owning user.
- Added focused Jest coverage for encrypted beneficiary storage, masked beneficiary listing, ledger-backed beneficiary withdrawal, and provider failure reversal.

Remaining blockers before launch:

- Add signed Paystack `transfer.success`, `transfer.failed`, and `transfer.reversed` webhook handling with provider-event idempotency.
- Add Flutterwave transfer webhook/status verification handling before enabling Flutterwave payout fallback.
- Make withdrawal reversal exactly-once at the database level for duplicate webhooks/admin retries.
- Harden withdrawal idempotency recovery for provider-side effects that may succeed before local completion is recorded.
- Add admin pending-withdrawal queue, provider verify/retry actions, hold/release controls, and `AuditLog` writes.
- Add E2E coverage for beneficiary ownership, deleted-beneficiary rejection, duplicate withdrawal keys, timeout-as-pending, and duplicate webhook reversal replay.
