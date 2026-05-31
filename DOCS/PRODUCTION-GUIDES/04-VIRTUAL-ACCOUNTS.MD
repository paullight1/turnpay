# Production Guide: Virtual Accounts

## Scope

Use this guide for dedicated virtual account provisioning and deposit processing. TRUSTPAY uses Monnify only for Nigerian NGN wallet funding to avoid duplicate user account numbers and support confusion.

## Required Env Vars

```env
BANKING_ENABLED=false
VIRTUAL_ACCOUNTS_ENABLED=false
BANKING_PROVIDER_PRIMARY=monnify
BANKING_PROVIDER_FALLBACK=
SUPPORTED_BANKING_CURRENCIES=NGN
BANKING_SANDBOX_MODE=true
MONNIFY_API_KEY=
MONNIFY_SECRET_KEY=
MONNIFY_CONTRACT_CODE=
MONNIFY_BASE_URL=https://sandbox.monnify.com
MONNIFY_WEBHOOK_URL=
MONNIFY_WEBHOOK_SECRET=
MONNIFY_GET_ALL_AVAILABLE_BANKS=true
MONNIFY_RESTRICT_PAYMENT_SOURCE=false
BANK_ACCOUNT_ENCRYPTION_KEY=
PII_ENCRYPTION_KEY=
PII_KEY_VERSION=1
```

Do not configure Nomba or Paystack as virtual-account fallback providers. `BANKING_PROVIDER_PRIMARY` must be `monnify`, and `BANKING_PROVIDER_FALLBACK` must remain empty for the current product path.

## Sandbox Steps

1. Confirm provider sandbox supports dedicated virtual accounts for the selected business profile.
2. Use Monnify's sandbox simulator for reserved-account payments.
3. Provision a test virtual account for a KYC-approved test user.
4. Verify stored account numbers are encrypted or masked in all non-secret surfaces.
5. Simulate or perform a sandbox transfer into the virtual account.
6. Confirm webhook creates exactly one funding transaction and ledger credit.
7. Replay the webhook and confirm no duplicate credit.

## Live Steps

1. Complete Monnify merchant KYB and obtain production API credentials.
2. Confirm supported banks, KYC requirements, source-account restrictions, limits, settlement timing, and naming rules.
3. Set live encryption keys before provisioning any account.
4. Keep `VIRTUAL_ACCOUNTS_ENABLED=false` until live webhook smoke tests pass.
5. Provision one internal staff account, make a low-value bank transfer, and reconcile it end to end.
6. Enable virtual accounts gradually by KYC tier and supported currency.

## Verification Checklist

- [ ] Feature is blocked when `BANKING_ENABLED=false` or `VIRTUAL_ACCOUNTS_ENABLED=false`.
- [ ] Only eligible KYC users can provision accounts.
- [ ] Non-Monnify provider requests are rejected.
- [ ] Full account numbers are never logged or shown to unauthorized admins.
- [ ] Provider customer/account reference is unique and linked to one TRUSTPAY user.
- [ ] Deposit amount and provider reference are verified before crediting.
- [ ] Duplicate webhook or duplicate provider reference does not duplicate wallet credit.
- [ ] Monnify `monnify-signature` is verified from raw request bodies.
- [ ] Manual review exists for unmatched deposits, wrong names, provider mismatch, and delayed settlement.

## Launch Blockers

- Live Monnify reserved-account approval is missing.
- Encryption keys are missing or weak.
- Full bank account data appears in logs, exports, or admin tables without masking.
- Unmatched deposit handling is not staffed.
- Reconciliation cannot map provider deposits to wallet credits.
- E2E/idempotency coverage is missing for duplicate Monnify webhook replay.
