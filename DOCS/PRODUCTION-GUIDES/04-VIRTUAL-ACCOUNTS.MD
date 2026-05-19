# Production Guide: Virtual Accounts

## Scope

Use this guide for dedicated virtual account provisioning and deposit processing. TRUSTPAY is Paystack-first for this path, with Flutterwave reserved as a fallback only after provider contract and code behavior are confirmed.

## Required Env Vars

```env
BANKING_ENABLED=false
VIRTUAL_ACCOUNTS_ENABLED=false
BANKING_PROVIDER_PRIMARY=paystack
BANKING_PROVIDER_FALLBACK=flutterwave
SUPPORTED_BANKING_CURRENCIES=NGN
BANKING_SANDBOX_MODE=true
PAYSTACK_SECRET_KEY=
PAYSTACK_DVA_PREFERRED_BANK=test-bank
PAYSTACK_WEBHOOK_URL=
PAYSTACK_WEBHOOK_SECRET=
BANK_ACCOUNT_ENCRYPTION_KEY=
PII_ENCRYPTION_KEY=
PII_KEY_VERSION=1
```

## Sandbox Steps

1. Confirm provider sandbox supports dedicated virtual accounts for the selected business profile.
2. Use `test-bank` or the provider-approved sandbox bank slug.
3. Provision a test virtual account for a KYC-approved test user.
4. Verify stored account numbers are encrypted or masked in all non-secret surfaces.
5. Simulate or perform a sandbox transfer into the virtual account.
6. Confirm webhook creates exactly one funding transaction and ledger credit.
7. Replay the webhook and confirm no duplicate credit.

## Live Steps

1. Obtain live DVA approval from Paystack and confirm supported banks, limits, settlement timing, and naming rules.
2. Configure live `PAYSTACK_DVA_PREFERRED_BANK` only after provider confirms availability.
3. Set live encryption keys before provisioning any account.
4. Keep `VIRTUAL_ACCOUNTS_ENABLED=false` until live webhook smoke tests pass.
5. Provision one internal staff account, make a low-value bank transfer, and reconcile it end to end.
6. Enable virtual accounts gradually by KYC tier and supported currency.

## Verification Checklist

- [ ] Feature is blocked when `BANKING_ENABLED=false` or `VIRTUAL_ACCOUNTS_ENABLED=false`.
- [ ] Only eligible KYC users can provision accounts.
- [ ] Full account numbers are never logged or shown to unauthorized admins.
- [ ] Provider customer/account reference is unique and linked to one TRUSTPAY user.
- [ ] Deposit amount and provider reference are verified before crediting.
- [ ] Duplicate webhook or duplicate provider reference does not duplicate wallet credit.
- [ ] Manual review exists for unmatched deposits, wrong names, provider mismatch, and delayed settlement.

## Launch Blockers

- Live DVA approval is missing.
- Encryption keys are missing or weak.
- Full bank account data appears in logs, exports, or admin tables without masking.
- Unmatched deposit handling is not staffed.
- Reconciliation cannot map provider deposits to wallet credits.
