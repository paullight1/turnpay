# Exchange Admin Review Backend Gap (Superseded)

## Status

Superseded. This document described an earlier backend gap for admin-reviewed exchange receipts. The backend/admin flow has since been implemented under the manual NGN to GHS receipt flow, using receipt-specific endpoints rather than the older proposed `/api/exchange/requests` API shape.

Authoritative current guide: `DOCS/PRODUCTION-GUIDES/14-MANUAL-EXCHANGE-RECEIPT-FLOW.MD`.

Related status guide: `DOCS/PRODUCTION-GUIDES/13-MONNIFY-ONLY-VIRTUAL-ACCOUNTS-STATUS.MD`.

## Implemented Backend/Admin Flow

- `POST /api/exchange/receipts` lets a verified, active user submit an NGN bank receipt for manual NGN to GHS exchange review.
- `POST /api/exchange/receipts/upload-url` creates a signed upload URL for protected receipt proof storage.
- `GET /api/exchange/receipts/:receiptId/proof-url` lets the owner open proof through a short-lived signed read URL.
- `GET /api/exchange/receipts` returns the signed-in user's manual receipt history.
- `GET /api/admin/exchange/receipts?status=SUBMITTED&limit=50` gives finance admins a filtered manual receipt queue.
- `POST /api/admin/exchange/receipts/:receiptId/proof-url` lets finance open receipt proof through an audited short-lived signed read URL.
- `POST /api/admin/exchange/receipts/:receiptId/review` lets finance admins approve-and-credit, reject, or request more information.
- Approval credits the user's GHS wallet through the ledger inside a Prisma transaction.
- Admin review actions are audit logged.
- The dashboard exchange page exposes a Deposit receipt form and receipt history.
- The admin page exposes the manual receipt review queue and review controls.
- Monnify-only NGN virtual account provisioning is implemented separately from this manual exchange receipt flow.

## Important Difference From The Old Plan

The older proposed endpoints below are not the current implementation target:

- `POST /api/exchange/requests`
- `GET /api/admin/exchange/requests?status=PENDING`
- `POST /api/admin/exchange/requests/:id/approve`
- `POST /api/admin/exchange/requests/:id/decline`

Do not use this file as an active backend implementation checklist. Use the production guide and current endpoint names above.

## Remaining Gaps

The backend/admin gap is closed, but these launch gaps remain:

- Production environment setup is still required for Monnify live credentials, the private `EXCHANGE_RECEIPT_BUCKET`, storage secrets, public collection-account display variables, migration deployment, and feature flags.
- Production reconciliation is still required to tie each credited receipt to bank statement or provider settlement evidence.
- Backend e2e and idempotency tests are still required for receipt submission, admin review, duplicate review attempts, missing idempotency keys, non-admin denial, and duplicate Monnify webhook replay.

## Safety Rules That Still Apply

- All mutations must be idempotent.
- Use Prisma transactions for every balance move.
- Do not credit GHS before finance verifies the NGN deposit.
- Do not allow negative balances.
- Audit log every admin review action.
- Preserve transaction reference, bank reference, ledger source, credited amount, admin identity, and review reason for reconciliation.
