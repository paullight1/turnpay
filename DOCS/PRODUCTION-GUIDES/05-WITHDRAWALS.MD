> Historical guide. Superseded for current deployment/provider decisions. Use [the current operations index](00-README.MD), [Paystack activation](../PAYSTACK-ACTIVATION.md), and [the migration runbook](20-MIGRATION-RUNBOOK.md). Customer OTP is Supabase email; Sentry is optional; Monnify is legacy-only; the recorded active backend host is Dokploy. Do not apply the old SMS/provider/platform setup below to production.

# Production Guide: Monnify Withdrawals

## Scope

Monnify is the only provider for bank lists, account resolution, beneficiaries,
withdrawal initiation, transfer status, callbacks, and reversals.

## Required env

```env
BANKING_ENABLED=false
WITHDRAWALS_ENABLED=false
BANKING_PROVIDER_PRIMARY=monnify
BANKING_PROVIDER_FALLBACK=
BANKING_SANDBOX_MODE=true
MONNIFY_BASE_URL=https://sandbox.monnify.com
MONNIFY_API_KEY=
MONNIFY_SECRET_KEY=
MONNIFY_CONTRACT_CODE=
MONNIFY_WEBHOOK_URL=https://api.yourdomain.com/api/webhooks/monnify
BANK_ACCOUNT_ENCRYPTION_KEY=
PII_ENCRYPTION_KEY=
```

## Activation

1. Confirm Monnify disbursement approval, transfer limits, fees, settlement balance,
   and supported banks.
2. Test account resolution and create a beneficiary with encrypted account data.
3. Submit a withdrawal with an `Idempotency-Key`; confirm the wallet debit and ledger
   entry are atomic and cannot create a negative balance.
4. Exercise success, failure, pending, timeout, and reversed states.
5. Verify signed callbacks and status reconciliation. A reversal must credit once.
6. Keep `WITHDRAWALS_ENABLED=false` until a controlled live payout reconciles across
   Monnify, the bank receipt, TRUSTPAY transaction, ledger, wallet, and audit log.

## Launch blockers

- Monnify transfer approval or sufficient settlement balance is missing.
- A retry can create a second provider transfer.
- A failure or reversal can credit more than once.
- Beneficiary data is unencrypted, unmasked, or not ownership-checked.
