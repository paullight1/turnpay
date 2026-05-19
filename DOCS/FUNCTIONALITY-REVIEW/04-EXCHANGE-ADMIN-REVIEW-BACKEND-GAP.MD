# Exchange Admin Review Backend Gap

## Current State

The mobile app exchange screen now creates a live quote and renders a review receipt.

Current backend behavior:

- `POST /api/exchange/quote` creates a live quote in Redis
- `POST /api/exchange/execute` immediately settles wallet-to-wallet exchange
- there is no persistent exchange review request for admin approval
- there is no admin approve or decline action for exchange receipts

## Required Backend Additions

### 1. Persistent exchange request model

Add an exchange review entity with:

- `id`
- `userId`
- `quoteId`
- `fromCurrency`
- `toCurrency`
- `amount`
- `fee`
- `rate`
- `sendAmount`
- `receiveAmount`
- `destinationLabel`
- `destinationAccount`
- `destinationInstitution`
- `note`
- `status` (`PENDING`, `APPROVED`, `DECLINED`, `EXPIRED`, `PAID_OUT`)
- `adminReason`
- `approvedBy`
- `approvedAt`
- `declinedBy`
- `declinedAt`

### 2. User submission endpoint

Create a protected endpoint:

- `POST /api/exchange/requests`

Rules:

- requires `JwtAuthGuard`
- requires `Idempotency-Key`
- validates payload with DTO
- verifies quote ownership and quote expiry
- stores payout destination details
- writes audit log
- returns the saved receipt payload

### 3. Admin review endpoints

Create admin-only endpoints:

- `GET /api/admin/exchange/requests?status=PENDING`
- `POST /api/admin/exchange/requests/:id/approve`
- `POST /api/admin/exchange/requests/:id/decline`

Rules:

- admin auth and role guard
- no generic status mutation
- approval must record admin identity and reason
- decline must record a user-visible reason
- every action must be audit logged

### 4. Settlement behavior

Approval should do one of these, explicitly:

1. debit source wallet and create payout instruction
2. confirm funds already reserved and release payout

Do not mix quote creation with settlement.

### 5. User notification flow

On decline:

- store admin reason
- expose it on user activity/history
- trigger notification entry

On approval:

- mark request approved
- show payout in progress or completed

## Recommended Sequence

1. add Prisma model and migration
2. add request creation endpoint
3. add admin list and approve/decline endpoints
4. wire admin panel queue
5. update mobile app to submit receipt to `/api/exchange/requests` instead of quote-only mode

## Important Safety Rules

- all mutations must be idempotent
- use Prisma transactions for every balance move
- do not auto-credit destination wallet before admin approval
- do not allow negative balances
- audit log every admin review action
