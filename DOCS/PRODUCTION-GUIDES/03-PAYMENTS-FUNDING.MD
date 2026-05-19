# Production Guide: Payments And Funding

## Scope

Use this guide for wallet funding through Paystack or Flutterwave payment links, checkout, and webhook crediting. Local tests cannot prove live card acceptance, provider settlement, chargeback handling, or webhook delivery from provider dashboards.

## Required Env Vars

```env
PAYSTACK_SECRET_KEY=
PAYSTACK_PUBLIC_KEY=
PAYSTACK_WEBHOOK_URL=
PAYSTACK_WEBHOOK_SECRET=
FLUTTERWAVE_SECRET_KEY=
FLUTTERWAVE_PUBLIC_KEY=
FLUTTERWAVE_ENCRYPTION_KEY=
FLUTTERWAVE_SECRET_HASH=
FLUTTERWAVE_WEBHOOK_URL=
BANKING_ENABLED=false
BANKING_PROVIDER_PRIMARY=paystack
BANKING_PROVIDER_FALLBACK=flutterwave
BANKING_SANDBOX_MODE=true
WEB_URL=
ADMIN_URL=
```

## Sandbox Steps

1. Configure sandbox keys for the selected primary provider.
2. Register the sandbox webhook URL in the provider dashboard.
3. Initiate a funding request with an `Idempotency-Key`.
4. Complete a sandbox payment and confirm one wallet credit only.
5. Replay the same webhook and confirm the response is idempotent.
6. Trigger failed, abandoned, and mismatched-amount scenarios.
7. Confirm provider amount, currency, and reference match TRUSTPAY records before crediting.

## Live Steps

1. Complete provider KYC, business approval, and settlement account setup.
2. Replace sandbox keys with live keys in the production secret manager.
3. Register the production HTTPS webhook URL.
4. Confirm webhook signature verification with a live provider event.
5. Keep `BANKING_ENABLED=false` until a low-value live funding smoke test is scheduled.
6. Enable `BANKING_ENABLED=true` for a limited user/admin cohort.
7. Reconcile the first live payment through provider dashboard, database transaction, ledger entry, wallet balance, and settlement report.

## Verification Checklist

- [ ] Payment creation rejects missing or duplicate `Idempotency-Key` misuse.
- [ ] Webhook handler verifies provider signature.
- [ ] Webhook handler is idempotent by provider reference.
- [ ] Wallet credit uses Decimal and a Prisma transaction.
- [ ] TRUSTPAY verifies amount and currency against its own expected transaction.
- [ ] Raw provider payloads are retained only where compliant and secrets are masked.
- [ ] Admin can inspect pending, successful, failed, and mismatch cases.
- [ ] Failed provider events never credit wallets.

## Launch Blockers

- Provider account is not approved for live collections.
- Webhook signature verification cannot be demonstrated.
- Payment success can credit more than once.
- Mismatched amount or currency can be credited.
- Settlement account, fees, chargeback handling, or refund process is undocumented.
