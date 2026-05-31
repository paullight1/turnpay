# Phase 06: Admin Operations And Reconciliation

## Goal

Give operations staff the panels, confirmations, and reconciliation tools needed to safely manage banking activity.

## Owners

- Primary: `trustpay-admin-ops-engineer`
- Reviewers: `trustpay-reconciliation-qa-engineer`, `trustpay-security-risk-engineer`, `trustpay-devops-sre`, `trustpay-frontend-mobile-engineer`

## Admin Features

- Banking overview.
- Virtual account registry.
- Deposit event log.
- Withdrawal queue.
- Internal transfer monitor.
- Provider event log.
- Reconciliation reports.
- Risk review queue.
- Audit log viewer.
- User limits and suspension review.

## Work Items

- Build admin APIs with typed actions instead of generic status edits.
- Add confirmation dialogs for high-risk actions.
- Require reason capture for admin actions.
- Add reconciliation job for provider vs local records.
- Add stale pending detection.
- Add audit log entries for every admin action.
- Add alert thresholds for failed webhooks and reconciliation mismatches.

## Tests

- Non-admin cannot access admin banking APIs.
- Admin mutation without idempotency key fails.
- Admin action without reason fails.
- Retry verification updates only allowed statuses.
- Reconciliation identifies local-only, provider-only, amount mismatch, and stale pending cases.

## Acceptance Criteria

- Admins never need direct database edits for banking support.
- Every admin money-related action is audited.
- Reconciliation can explain all provider/local mismatches.

## Implementation Status

Status: backend admin/reconciliation foundation implemented; production launch blockers remain.

Completed in this phase:

- Added admin banking APIs for overview, virtual account registry, provider-event log, pending withdrawal queue, reconciliation report/run, transfer verification, and audit-log listing.
- Admin banking responses sanitize provider payloads and metadata so raw account numbers, encrypted account values, signatures, tokens, BVN/NIN, and secrets are not returned.
- Admin user update, suspend, and unsuspend actions now require a reason and write `AuditLog` rows.
- Generic admin transaction status edits are blocked for withdrawals; banking withdrawals must use the typed verification flow.
- Transfer verification now calls provider verification server-side before updating local transaction and transfer-attempt status.
- Failed/reversed provider verification uses `LedgerService.creditWallet` for reversal and checks for an existing `WITHDRAWAL_REVERSAL` ledger entry first.
- Raw webhook body capture was moved ahead of route handling by disabling Nest's default parser and registering the verified JSON parser before the global API prefix/guards.
- Scheduled wallet reconciliation now derives expected balances from ledger entries with Decimal math.
- Added focused admin service tests for provider-backed verification, audit creation, failed withdrawal reversal, and blocking generic withdrawal status edits.

Remaining blockers before launch:

- Add signed transfer webhook ingestion for Paystack and Flutterwave with provider-event idempotency and replay tests.
- Harden DB-backed idempotency recovery for financial/admin mutations that may time out or crash after provider-side effects.
- Add database-level uniqueness or reversal markers to make failed withdrawal reversal exactly-once under concurrent webhook/admin retries.
- Refactor legacy fund-wallet webhook deposits to use `ProviderEvent` and `LedgerService`.
- Persist reconciliation reports instead of returning generated snapshots only.
- Add E2E tests for non-admin denial, missing idempotency key, short/missing reason, duplicate admin verify/reverse, webhook replay, and metadata redaction.

## Hardening Checkpoint

May 21, 2026:

- Backend compile passes.
- Focused banking unit tests pass for ledger, banking, beneficiaries, transfers, payments, admin service, and idempotency.
- Reconciliation service now uses `LedgerEntry` as the balance source of truth.
- Launch remains blocked on provider signoff, E2E replay/signature coverage, persisted reconciliation reports, and frontend/admin operational panels.
