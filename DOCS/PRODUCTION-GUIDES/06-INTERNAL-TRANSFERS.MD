# Production Guide: Internal Transfers

## Scope

Use this guide for TRUSTPAY user-to-user wallet transfers. This is less provider-dependent than external payments, but production readiness still requires live auth, KYC policy, audit logs, rate limits, and reconciliation evidence.

## Required Env Vars

```env
BANKING_ENABLED=false
SUPPORTED_BANKING_CURRENCIES=NGN
DATABASE_URL=
REDIS_HOST=
REDIS_PORT=6379
REDIS_PASSWORD=
```

## Sandbox Steps

1. Create two KYC-approved test users with funded wallets.
2. Initiate a transfer with `Idempotency-Key`.
3. Confirm sender debit and recipient credit occur in one Prisma transaction.
4. Repeat the same idempotency key and confirm the original response is returned.
5. Attempt insufficient-balance, unsupported-currency, same-user, blocked-user, and rate-limit cases.
6. Confirm transaction history shows both sender and recipient records clearly.

## Live Steps

1. Confirm product policy for user discovery, recipient confirmation, limits, fees, and reversal handling.
2. Confirm KYC tier requirements and AML monitoring thresholds.
3. Keep feature hidden or gated until production auth, audit, and reconciliation are active.
4. Run an internal staff transfer with a low amount.
5. Reconcile sender wallet, recipient wallet, transaction table, ledger entries, and admin audit trail.

## Verification Checklist

- [ ] Route requires auth guard and DTO validation.
- [ ] Request requires `Idempotency-Key`.
- [ ] Sender and recipient wallets are locked or updated transactionally.
- [ ] Sender wallet cannot go negative.
- [ ] Decimal is used for all amounts.
- [ ] Transfer creates matching debit and credit ledger entries.
- [ ] Limits and rate limits are enforced.
- [ ] Admin and support views mask recipient sensitive data.

## Launch Blockers

- Transfer is possible without KYC or approved eligibility rules.
- Duplicate request can transfer twice.
- Debit and credit can diverge.
- No fraud, AML, or support review path for suspicious transfers.
