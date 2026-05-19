# Phase 03: Virtual Accounts And Deposits

## Goal

Allow verified users to receive wallet funding through provider-backed virtual accounts.

## Owners

- Primary: `trustpay-payments-architect`
- Reviewers: `trustpay-ledger-backend-engineer`, `trustpay-security-risk-engineer`, `trustpay-compliance-aml-officer`, `trustpay-admin-ops-engineer`

## Backend APIs

- `GET /banking/accounts`
- `POST /banking/accounts/provision`
- Provider webhook handling for deposit events.
- Admin virtual account listing.

## Work Items

- Implement provider abstraction for virtual account provisioning.
- Enforce KYC and suspension gates.
- Store provider customer and virtual account metadata.
- Process deposit webhooks through `ProviderEvent`.
- Validate amount, currency, account mapping, and provider reference before wallet credit.
- Create ledger entry when crediting wallet.

## Admin Work

- Show virtual account status by user.
- Show failed account provisioning attempts.
- Show deposit webhook events and processing result.

## Tests

- Verified user can provision sandbox virtual account.
- Unverified or suspended user cannot provision account.
- Duplicate webhook does not double-credit.
- Mismatched amount or currency does not credit wallet.
- Invalid signature is rejected.

## Acceptance Criteria

- User wallet is credited only after verified provider event.
- Duplicate provider events are idempotent.
- Admin can inspect deposit event outcome.

## Implementation Status

Status: `IMPLEMENTED FOR PAYSTACK-FIRST SANDBOX PATH`

Implemented in backend:

- Added `BankingModule`, `BankingController`, and `BankingService`.
- Added guarded user APIs:
  - `GET /api/banking/accounts`
  - `POST /api/banking/accounts/provision`
- Added Paystack virtual account provider method for DVA assignment.
- Enforced verified KYC and non-suspended user checks before virtual account provisioning.
- Added provider-event driven deposit processing for virtual-account bank-transfer webhooks.
- Added duplicate provider event no-op behavior.
- Validates virtual account status, user suspension, KYC, currency, account mapping, and positive amount before wallet credit.
- Credits wallet through `LedgerService` and creates a `LedgerEntry`.
- Redacts provider payloads before storing them in `ProviderEvent`.
- Removed webhook signature values from warning logs.
- Split Flutterwave `transfer.completed` away from deposit processing by only using `charge.completed` for deposit fallback handling.
- Added focused tests for KYC provisioning gate, virtual account upsert, deposit credit, duplicate event idempotency, and currency mismatch failure.

Remaining for later phases:

- Confirm Flutterwave API version/signature scheme before full Flutterwave virtual account implementation.
- Add explicit webhook DTO/runtime validation for malformed provider payloads.
- Add controller/e2e tests for invalid signatures and raw-body behavior.
- Add admin provider-event/deposit panels from Phase 6 before production.
- Add queue/DLQ processing before high-volume or production webhook handling.
