# Production Guide: Withdrawals

## Scope

Use this guide for bank beneficiaries, name resolution, transfer initiation, payout verification, reversal, and admin review. Local tests cannot prove live bank rails, provider transfer limits, settlement balance, approval OTPs, or provider-side reversal timing.

## Required Env Vars

```env
BANKING_ENABLED=false
WITHDRAWALS_ENABLED=false
BANKING_PROVIDER_PRIMARY=paystack
BANKING_PROVIDER_FALLBACK=flutterwave
BANKING_SANDBOX_MODE=true
PAYSTACK_SECRET_KEY=
PAYSTACK_TRANSFER_SOURCE=
FLUTTERWAVE_SECRET_KEY=
FLUTTERWAVE_ENCRYPTION_KEY=
BANK_ACCOUNT_ENCRYPTION_KEY=
PII_ENCRYPTION_KEY=
ADMIN_REVIEW_WEBHOOK_ALERT_CHANNEL=
```

## Sandbox Steps

1. Resolve a sandbox bank account and create a beneficiary.
2. Initiate withdrawal with `Idempotency-Key`.
3. Confirm wallet debit is atomic and cannot produce a negative balance.
4. Trigger provider success, failure, pending, and retryable timeout cases.
5. Confirm failed or reversed withdrawals credit the wallet once.
6. Confirm admin verification can compare TRUSTPAY status with provider status.
7. Confirm sensitive beneficiary details are masked in logs and UI.

## Live Steps

1. Confirm provider transfer permission, payout countries, supported currencies, transfer source, fees, OTP/approval settings, and settlement balance requirements.
2. Configure live provider keys and transfer source in production secrets.
3. Keep `WITHDRAWALS_ENABLED=false` until provider live verification succeeds.
4. Set initial withdrawal limits by KYC tier and risk posture.
5. Execute one internal low-value withdrawal to a controlled account.
6. Verify bank receipt, provider dashboard status, TRUSTPAY transaction, ledger entries, wallet balance, and audit log.
7. Enable withdrawals by cohort, then by KYC tier.

## Verification Checklist

- [ ] Withdrawal endpoint requires auth guard and DTO validation.
- [ ] Withdrawal request requires `Idempotency-Key`.
- [ ] Beneficiary ownership is enforced.
- [ ] Wallet debit and transaction creation happen in one Prisma transaction.
- [ ] Provider pending status does not trigger duplicate retries.
- [ ] Reversal checks for an existing reversal ledger entry before crediting.
- [ ] Admin actions are role-gated and audit logged.
- [ ] Users receive clear pending, successful, failed, and reversed states.

## Launch Blockers

- Provider transfer approval or transfer source is missing.
- No process exists for stuck pending withdrawals.
- Reversal path can credit more than once.
- Beneficiary data is unencrypted or unmasked.
- Withdrawal limits, fees, and support escalation path are not approved.
