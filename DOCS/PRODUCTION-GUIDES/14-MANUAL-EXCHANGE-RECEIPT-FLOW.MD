# Historical Monnify-Verified Exchange Deposit Flow

This guide documents retained legacy receipt obligations. New direct-account V1 exchanges use `/api/exchange/manual-orders`; follow [the current manual-exchange instructions](../MANUAL-EXCHANGE-ADMIN-TRIGGERS.md). Do not activate new Monnify collection or reinterpret an existing wallet credit as an external payout.

## Current Implementation Status

Implemented in this branch:

- `POST /api/exchange/monnify-deposit-intents` lets a verified, active user create a pending NGN to GHS Monnify deposit instruction.
- `POST /api/exchange/receipts` lets a verified, active user submit an NGN bank receipt for a manual NGN to GHS exchange.
- `POST /api/exchange/receipts/upload-url` creates a signed upload URL for protected receipt proof storage.
- `GET /api/exchange/receipts/:receiptId/proof-url` lets the signed-in owner open their stored proof through a short-lived signed read URL.
- `GET /api/exchange/receipts` returns the signed-in user's manual receipt history.
- `GET /api/admin/exchange/receipts?status=SUBMITTED&limit=50` gives finance admins a filtered receipt queue.
- `POST /api/admin/exchange/receipts/:receiptId/proof-url` lets finance open proof with an audited short-lived signed read URL.
- `POST /api/admin/exchange/receipts/:receiptId/review` lets an admin approve-and-credit, reject, or request more information.
- `POST /api/webhooks/monnify` now attempts to match successful Monnify payments to pending exchange deposit instructions before falling back to NGN wallet funding.
- Matched Monnify exchange deposits are marked provider-verified for admin review; they are not auto-credited.
- Approval credits the user's GHS wallet through `LedgerService.creditWallet` inside a Prisma transaction.
- The admin action creates an `AuditLog` record and uses `MANUAL_EXCHANGE_RECEIPT_CREDIT` as the unique ledger source.
- The dashboard exchange page now has a Deposit receipt tab for creating Monnify references and tracking provider/admin status.
- The admin page now shows the live exchange deposit queue with Monnify verified evidence and credit/reject review controls.

This supersedes the stale backend-gap note in `DOCS/FUNCTIONALITY-REVIEW/04-EXCHANGE-ADMIN-REVIEW-BACKEND-GAP.MD`.

## Product Direction

For the first NGN to GHS exchange launch, users create a Monnify exchange deposit instruction, transfer NGN with the generated reference, Monnify verifies the inflow, and operations credits the user's GHS wallet after review. Manual receipt upload remains a fallback path.

## Required Controls

- Monnify deposit instruction creation and manual receipt submission must require an idempotency key.
- Receipt upload must be tied to a verified user and a specific exchange receipt.
- Admin approval must require a reason and audit log.
- GHS wallet credit must use `Decimal` and a Prisma transaction.
- No GHS wallet credit should happen until the deposit is verified by Monnify or by finance fallback review.
- Duplicate receipt references, bank references, or admin approvals must not double-credit.
- Rejected receipts must preserve an audit trail and a user-visible reason.
- Receipt files must live in protected storage or be exposed only through short-lived signed URLs. Do not rely on public receipt URLs in production.

## Proposed Status Model

- `SUBMITTED`
- `UNDER_REVIEW`
- `APPROVED`
- `CREDITED`
- `REJECTED`
- `NEEDS_MORE_INFO`

`APPROVED` is used for Monnify/provider verified deposits waiting for admin credit. The admin review action `APPROVED` then credits the GHS wallet and stores the receipt as `CREDITED`, because admin approval and wallet credit happen in one transaction.

## Admin Requirements

- Finance dashboard shows pending and provider-verified exchange deposits.
- Admin can compare NGN amount, generated reference, Monnify provider reference, verification status, and expected GHS credit.
- Admin can credit a Monnify verified deposit in one audited action.
- Admin can reject with a reason.
- Admin can filter exchange transactions by `PENDING`, `SUCCESS`, `FAILED`, and `REVERSED`.

## Launch Note

This flow is not the same as automatic Monnify NGN wallet funding. It is an operations-controlled exchange workflow: Monnify verifies the NGN inflow, then admin credits GHS.

Monnify-only virtual accounts are implemented separately for NGN wallet funding. The Monnify webhook checks the exchange deposit queue first; only unmatched normal funding events should continue to automatic NGN wallet funding.

## Remaining Gaps Before Production

- Production env must include live Monnify credentials, webhook secret, optional `MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER`, database/Redis settings, migration deployment, and feature flags before enabling real exchange deposits.
- Reconciliation must tie each credited receipt to bank statement or Monnify settlement evidence using transaction reference, bank reference, ledger source, amount, currency, admin reviewer, and timestamp.
- Backend e2e and idempotency tests are still needed for Monnify deposit instruction creation, Monnify webhook matching, unmatched webhook fallback, admin review, duplicate review attempts, missing idempotency keys, non-admin denial, terminal-state rejection, and duplicate Monnify webhook replay.

## Operations Checklist

- Apply migration `011_manual_exchange_receipts` before enabling the UI in production.
- Confirm every admin action includes an `Idempotency-Key`; the web client holds a stable key per review attempt.
- Confirm customer receipt submission uses a stable `Idempotency-Key` per visible submit attempt.
- Set `MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER` if exchange deposits should only match one collection account; otherwise the user's Monnify NGN virtual account is shown.
- Finance should credit only rows marked Monnify verified unless using the manual fallback.
- Reconcile every credited receipt using transaction reference, bank reference, ledger entry source, credited amount, and admin audit log.
- Keep receipt URLs time-limited or storage-protected; do not expose raw provider payloads or secrets in the admin UI.
