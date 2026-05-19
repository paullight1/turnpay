# Bank Transfer And Receival Implementation Plan

## Objective

Users should be able to receive money into a provider-assigned virtual account and withdraw wallet funds to a verified bank account without double-crediting, double-refunding, or losing audit traceability.

## Current Reality

- Virtual account models and provider webhook handling exist.
- Paystack and Flutterwave webhook endpoints exist.
- Withdrawal creates a local transaction, debits the wallet, and starts a provider transfer.
- Admin banking endpoints exist for pending withdrawals and reconciliation.

## Required Backend Work

1. Deposit/receival
   - Store every provider event first with a unique provider/event/reference key.
   - Treat duplicate provider events as idempotent success.
   - Match incoming deposit to virtual account by provider plus account number.
   - Validate account status, user KYC, user suspension, amount, and currency.
   - Credit the wallet only once through `LedgerService`.
   - Create `AuditLog` entries for deposit accepted, ignored, failed, and reversed states.

2. Withdrawal
   - Keep provider timeout and unknown exceptions as `PENDING`.
   - Reverse only after signed webhook, provider verification, or admin reconciliation confirms failure.
   - Enforce daily/monthly limits atomically inside the same Prisma transaction as wallet debit.
   - Store transfer attempts for every provider call.
   - Show pending status clearly to users.

3. Provider verification
   - Paystack: verify transfer/deposit by provider reference and signed webhook.
   - Flutterwave: configure one verification mode and implement it exactly (`flw-signature` or `verif-hash`).
   - Never trust frontend success status.

## Required Admin Work

- Pending withdrawals queue.
- Provider events queue.
- Stale pending transfers queue.
- Reconciliation report.
- Verify provider status action with required reason.
- Reverse failed withdrawal action with required reason.
- Audit log screen with filters.

## External Help Needed

- Paystack or Flutterwave production account approval.
- Production webhook URL registration.
- Bank list and account resolution production access.
- Compliance review for KYC tier limits and supported corridors.

## Acceptance Criteria

- Duplicate deposit webhooks do not double-credit.
- Provider transfer timeout does not refund user until confirmed failed.
- Failed withdrawal reversal cannot run twice.
- Admin actions require reason and appear in audit logs.
- User sees `PENDING`, `SUCCESS`, `FAILED`, or `REVERSED` status consistently across mobile and web.
