# TRUSTPAY Real-Time Banking PRD

> Archived provider-planning record. Use `DOCS/PROVIDER-SOURCE-OF-TRUTH.MD`: Monnify is the only active banking/payment provider.

## Objective

Build TRUSTPAY's next banking phase as a wallet-first financial platform. Users should be able to receive money through provider-backed virtual accounts, send money instantly to other TRUSTPAY users, and withdraw wallet balances to external bank accounts.

This document is a product and architecture plan only. Do not provision live virtual accounts, implement provider calls, run migrations, or create banking endpoints until explicitly instructed.

## Current Reality

TRUSTPAY already has:

- NestJS backend with Prisma, PostgreSQL, Redis, JWT auth, KYC, wallets, payments, transactions, admin, and webhooks.
- Wallets for `NGN` and `GHS`.
- Existing Paystack and Flutterwave provider classes.
- Idempotency interceptor for mutation endpoints.
- Security rules in `DOCS/SECURITY-RULES.MD`.

Missing for real-time banking:

- User virtual account records.
- Saved bank beneficiaries.
- Internal user-to-user transfers.
- Provider transfer lifecycle tracking.
- Double-entry ledger or immutable ledger entries.
- Provider event idempotency and webhook replay records.
- Reconciliation reports and operational review tools.
- Stronger withdrawal status handling and reversal workflow.

## Banking Model

Use a wallet-first model for the first production banking phase.

Users do not receive true TRUSTPAY-owned bank accounts unless TRUSTPAY has a licensed bank or Banking-as-a-Service partner that explicitly supports that arrangement. With Paystack or Flutterwave virtual accounts, the account is normally issued by the provider or provider partner bank.

### Bank Name Display

The sending bank will usually show the provider or partner bank name, not "TrustPay Bank".

Examples:

- Paystack Dedicated Virtual Accounts may show a partner bank such as Wema, Titan/Paystack, or another supported settlement bank depending on the merchant setup.
- Flutterwave virtual accounts may show a Flutterwave-supported partner bank depending on the product and country.

The account name may include a TRUSTPAY/customer naming pattern if the provider supports it, but the bank name itself is controlled by the licensed provider or issuing bank. Do not promise "TrustPay Bank" to users unless a licensed bank/BaaS contract permits that exact display.

## User Capabilities

1. Virtual account funding
   - Verified users can provision a virtual account.
   - Incoming bank transfers credit the user's TRUSTPAY wallet after verified webhook confirmation.
   - Webhook payload must match account, amount, currency, and provider reference.

2. Internal TRUSTPAY transfers
   - Users can send money to another TRUSTPAY user by phone, email, username, or internal account identifier.
   - Sender debit and recipient credit must happen in one Prisma transaction.
   - Both sides must have transaction records and ledger entries.

3. External withdrawals
   - Users can resolve and save external bank accounts.
   - Withdrawals go through Paystack or Flutterwave transfer APIs.
   - Failed provider transfers must reverse wallet debit idempotently.

4. Beneficiaries
   - Users can save, list, and delete external bank beneficiaries.
   - Account number should be encrypted at rest and masked in API responses.

5. Admin operations
   - Admins can view pending transfers, provider events, virtual accounts, reconciliation reports, and failed webhooks.
   - Admin status changes must be audited.
   - Manual wallet credits/debits should only happen through controlled audited adjustment flows.

## Internal APIs To Create Later

Do not implement these until execution is explicitly requested.

### Banking Accounts

- `GET /banking/accounts`
  - Return the current user's virtual accounts.
  - Protected by `JwtAuthGuard`.

- `POST /banking/accounts/provision`
  - Provision a provider virtual account for a verified user.
  - Requires `Idempotency-Key`.
  - Enforce KYC, supported currency, user suspension status, and provider availability.

- `GET /banking/banks?currency=NGN`
  - Return supported provider banks from cache.

- `POST /banking/banks/resolve`
  - Resolve `accountNumber`, `bankCode`, and `currency`.
  - Validate using DTOs.

- `POST /banking/beneficiaries`
  - Save a resolved beneficiary.
  - Requires `Idempotency-Key`.

- `GET /banking/beneficiaries`
  - List saved user beneficiaries.

- `DELETE /banking/beneficiaries/:id`
  - Soft delete a beneficiary.

### Money Movement

- `POST /transfers/internal`
  - Send wallet funds to another TRUSTPAY user.
  - Requires `Idempotency-Key`.
  - Must use one database transaction for sender debit, recipient credit, transaction records, and ledger entries.

- `POST /payments/withdraw`
  - Refactor existing endpoint into a proper withdrawal lifecycle.
  - Accept either `beneficiaryId` or raw resolved bank details.
  - Requires `Idempotency-Key`.

- `GET /payments/withdrawals/:reference`
  - Return withdrawal status, provider status, destination, fee, and timestamps.

### Webhooks

- `POST /webhooks/paystack`
  - Handle DVA deposit events and transfer status events separately.
  - Verify signature and store provider event idempotently.

- `POST /webhooks/flutterwave`
  - Handle bank transfer collection events and payout transfer events separately.
  - Current behavior must not treat transfer completion as wallet deposit.

### Admin

- `GET /admin/banking/accounts`
- `GET /admin/transfers/pending`
- `POST /admin/transfers/:reference/verify`
- `POST /admin/reconciliation/run`
- `GET /admin/reconciliation/reports`

## Database Objects To Add Later

- `VirtualAccount`
  - User provider account assignment.
  - Fields: userId, provider, providerCustomerId, accountNumber, accountName, bankName, currency, status, metadata.

- `BankAccount`
  - User external bank beneficiary.
  - Fields: userId, bankCode, bankName, accountName, accountNumberEncrypted, accountNumberMasked, currency, provider, isDeleted.

- `LedgerEntry`
  - Immutable wallet movement record.
  - Fields: transactionId, walletId, direction, amount, currency, balanceBefore, balanceAfter, reference.

- `ProviderEvent`
  - Raw provider webhook and replay safety record.
  - Fields: provider, eventType, providerReference, payload, status, processedAt.

- `TransferAttempt`
  - Provider withdrawal attempt lifecycle.
  - Fields: transactionId, provider, providerReference, providerStatus, attemptNo, lastCheckedAt, metadata.

All money fields must use `Decimal`. Never use `Float` for money.

## Third-Party Providers

### Paystack

Recommended primary provider for the first NGN launch:

- Dedicated Virtual Accounts for bank-transfer wallet funding.
- Transfer Recipient and Transfer APIs for withdrawals.
- Webhooks as the source of truth for asynchronous deposit and transfer completion.

Important constraint: Dedicated Virtual Accounts are available to eligible Nigerian businesses after go-live approval. Confirm merchant eligibility in the Paystack dashboard before launch.

Current provider notes to verify again before build:

- Paystack Dedicated Virtual Accounts are available to registered businesses in Nigeria and Ghana that have completed go-live.
- Financial services businesses may need customer identity validation before a DVA can be generated.
- Paystack account names commonly follow a product/customer naming pattern, while the bank name is the provider or partner bank.
- Transfer webhooks include success and failure events and must drive final payout state.

### Flutterwave

Recommended fallback or multi-country provider:

- Bank transfer collection.
- Bank and mobile money transfers depending on country/currency support.
- Webhooks for asynchronous completion.

Use a provider abstraction so provider-specific statuses normalize into TRUSTPAY statuses.

Current provider notes to verify again before build:

- Flutterwave NGN virtual accounts provide generated account number and bank name for direct bank transfers.
- Flutterwave bank-transfer collections produce `charge.completed` webhooks.
- Flutterwave transfer completion must be handled separately from deposit completion.

### Mono or Okra

Optional only. Add open banking if TRUSTPAY needs:

- External bank account statements.
- External account balance reads.
- Identity enrichment.
- Risk scoring.
- Direct bank debit features.

Open banking is not required for wallet funding, internal transfers, or withdrawals.

## Security And Financial Integrity

Every future implementation must follow `DOCS/SECURITY-RULES.MD`.

Mandatory rules:

- All mutation endpoints require idempotency keys.
- All balance mutations use Prisma transactions.
- All inputs use DTO validation.
- All protected routes use `JwtAuthGuard`.
- No hardcoded or logged secrets.
- Webhooks verify signatures.
- Provider events are idempotent.
- Financial transactions and admin actions are audited.
- No negative balances.
- Amounts use `Decimal`.
- Sensitive account data is encrypted or masked.

## Phased Delivery

1. Banking data model
   - Add virtual accounts, bank accounts, provider events, transfer attempts, and ledger entries.

2. Virtual account funding
   - Provision virtual accounts and process verified provider deposit webhooks.

3. Internal transfers
   - Add atomic TRUSTPAY-to-TRUSTPAY wallet transfer.

4. Withdrawals v2
   - Add beneficiaries and provider transfer lifecycle.

5. Reconciliation and operations
   - Add reconciliation jobs, admin review screens, alerts, and retry tools.

## Acceptance Criteria

- Duplicate requests cannot create duplicate money movement.
- Duplicate webhooks cannot double-credit or double-reverse wallets.
- A failed withdrawal reverses exactly once.
- Pending provider transfers can be verified and reconciled.
- Admins can inspect provider events and transaction status history.
- Users never see unsupported claims such as "TrustPay Bank" unless backed by licensing and provider display support.
