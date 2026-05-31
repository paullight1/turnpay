# Admin Approved Exchange Payout Plan

## Product Goal

Users should exchange between GHS and NGN and receive payout in the destination currency:

- User sends GHS/Cedis, receives NGN withdrawal.
- User sends NGN, receives GHS withdrawal or configured payout channel.
- Admin approves and processes each exchange through an admin wallet/treasury system.

## Current Reality

The current `/api/exchange/execute` flow is wallet-to-wallet FX:

- It debits the user's source wallet.
- It credits the user's destination wallet.
- It marks the exchange `SUCCESS` immediately.

That is useful for internal wallet conversion, but it is not the requested payout workflow.

## Required Data Model

Add a persistent exchange order model:

- `id`
- `userId`
- `quoteId`
- `sourceCurrency`
- `destinationCurrency`
- `sourceAmount`
- `fee`
- `rate`
- `destinationAmount`
- `destinationType` such as `BANK_ACCOUNT`, `MOBILE_MONEY`, or `WALLET`
- masked destination account details
- `status`: `PENDING_USER_FUNDING`, `PENDING_ADMIN_REVIEW`, `APPROVED`, `PROCESSING_PAYOUT`, `PAID`, `REJECTED`, `FAILED`, `REVERSED`
- `adminId`
- `adminReason`
- timestamps

Add explicit platform/admin treasury records:

- Platform wallet per currency.
- Settlement ledger entries from user source wallet to platform source wallet.
- Payout ledger entries from platform destination wallet or provider payout reference.
- Maker/checker approvals for large orders.

## Required Backend Flow

1. Quote
   - Use `Decimal` for all amounts, rates, fees, and receive amounts.
   - Store quote/order in Postgres instead of Redis-only state for auditable execution.

2. User submit
   - User selects direction and payout destination.
   - Backend validates KYC, limits, balance, destination format, and quote expiry.
   - Backend debits source wallet into an exchange hold using `LedgerService`.
   - Backend creates `ExchangeOrder` as `PENDING_ADMIN_REVIEW`.

3. Admin approve
   - Admin sees queue with source amount, destination amount, rate, margin, destination details, user KYC status, and risk flags.
   - Admin approves or rejects with required reason.
   - Approval moves order to `PROCESSING_PAYOUT`.

4. Payout
   - Provider payout is initiated or admin marks manual payout as sent.
   - Provider webhook/reconciliation confirms final status.
   - Order becomes `PAID`, `FAILED`, or `REVERSED`.

5. Reversal
   - If rejected before payout, source amount is returned once.
   - If payout fails, reversal requires typed admin action and audit trail.

## Required Mobile UX

- Exchange tab after Home.
- Direction selector: `GHS to NGN` and `NGN to GHS`.
- Send amount.
- Quote preview with rate, fee, receive amount, expiry.
- Destination form:
  - NGN bank payout: bank, account number, resolved account name.
  - GHS payout: provider-supported Ghana bank/mobile-money destination.
- Confirmation screen.
- Status screen: pending admin review, processing payout, paid, failed, reversed.

## Required Admin UI

- Pending exchange orders.
- Order detail.
- Approve/reject modal with reason.
- Process payout action.
- Mark manual payout sent action.
- Provider verification action.
- Audit trail per order.
- Treasury balance view for NGN and GHS.

## External Help Needed

- Provider support for Ghana payouts or mobile-money disbursement.
- Treasury operating process and bank accounts.
- Compliance decision on maximum exchange amounts, customer due diligence, sanctions checks, and suspicious activity escalation.

## Acceptance Criteria

- Exchange orders cannot execute twice with different idempotency keys.
- Every money movement creates ledger entries.
- Admin cannot change status generically.
- Admin reason and before/after state are captured.
- User sees accurate pending/admin-processing status until payout is confirmed.
