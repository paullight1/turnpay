# Production Guide: Monnify Funding

## Scope

Wallet funding uses Monnify reserved accounts and signed deposit webhooks. There is
no card/payment-link or alternate payment-provider path.

## Required env

```env
BANKING_ENABLED=false
VIRTUAL_ACCOUNTS_ENABLED=false
BANKING_PROVIDER_PRIMARY=monnify
BANKING_PROVIDER_FALLBACK=
BANKING_SANDBOX_MODE=true
MONNIFY_BASE_URL=https://sandbox.monnify.com
MONNIFY_API_KEY=
MONNIFY_SECRET_KEY=
MONNIFY_CONTRACT_CODE=
MONNIFY_WEBHOOK_URL=https://api.yourdomain.com/api/webhooks/monnify
```

## Activation

1. Complete Monnify KYB and enable reserved accounts and collections.
2. Store sandbox credentials only in the backend secret manager.
3. Register the public HTTPS webhook URL.
4. Provision a test reserved account and complete a sandbox deposit.
5. Confirm the signature, account/reference, currency, and expected amount before
   crediting.
6. Replay the same callback and confirm exactly one wallet credit and audit record.
7. Switch to the live base URL and live credentials only after approval, then run a
   controlled low-value deposit and reconcile it.

## Launch blockers

- A webhook can credit without a valid signature or can credit twice.
- Wallet credit is outside a Prisma transaction or does not use `Decimal`.
- Reserved-account ownership, amount, currency, or provider reference is not matched
  against TRUSTPAY records.
- Live callback delivery and reconciliation have not been demonstrated.
