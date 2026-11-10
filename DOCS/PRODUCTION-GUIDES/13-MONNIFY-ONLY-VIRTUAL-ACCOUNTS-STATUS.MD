> Historical guide. Superseded for current deployment/provider decisions. Use [the current operations index](00-README.MD), [Paystack activation](../PAYSTACK-ACTIVATION.md), and [the migration runbook](20-MIGRATION-RUNBOOK.md). Customer OTP is Supabase email; Sentry is optional; Monnify is legacy-only; the recorded active backend host is Dokploy. Do not apply the old SMS/provider/platform setup below to production.

> Provider update, 2026-10-30: new payment and automated BVN flows use Paystack. The Monnify implementation details below apply to legacy obligations. Follow [Paystack activation](../PAYSTACK-ACTIVATION.md) and the provider source of truth for current setup.

# Monnify-Only Virtual Accounts Status

## Decision

TRUSTPAY uses Monnify only for Nigerian NGN virtual accounts. Nomba and Paystack virtual-account provisioning are not active product paths.

## Current Backend State

- `POST /api/banking/accounts/provision` accepts only `provider=monnify`.
- `BANKING_PROVIDER_PRIMARY` accepts only `monnify`.
- `BANKING_PROVIDER_FALLBACK` must be empty.
- Monnify reserved-account creation requires verified KYC and a non-suspended user.
- Monnify deposits are processed through `ProviderEvent`, `Transaction`, and `LedgerEntry`.
- Duplicate Monnify webhook references do not double-credit wallets.
- Webhook signature verification uses the raw request body and `MONNIFY_SECRET_KEY`.
- The admin finance page now exposes Monnify funding health, failed provider events, virtual accounts, users, exchange transactions, and the NGN to GHS exchange deposit queue.
- Monnify can verify NGN inflow for exchange deposits. Matched exchange deposits are routed to admin review and do not auto-credit NGN or GHS.

## Current Web/Admin State

- `/dashboard/fund` shows the user's Monnify funding account and can request provisioning for eligible users.
- `/dashboard` wallet cards expose `Send Money` and `Receive Money` and route to wallet detail screens.
- `/dashboard/wallet/ngn` shows NGN balance, receiving account details, and NGN transaction history.
- `/dashboard/wallet/ghs` shows GHS balance/history and marks receiving account support as coming soon.
- `/admin` finance operations show Monnify funding health, virtual accounts, failed provider events, users/wallet balances, exchange activity, and the exchange deposit queue.
- Admin review can approve/reject exchange receipts; Monnify-verified receipts are labelled before crediting.

## Not In Scope

- Nomba virtual-account provisioning.
- Paystack dedicated virtual-account provisioning.
- Automatic GHS credit from receipt upload alone.
- Public receipt image URLs for production review.
- Double routing one Monnify inflow to both NGN wallet funding and GHS exchange credit.

## Required Environment

```env
BANKING_ENABLED=true
VIRTUAL_ACCOUNTS_ENABLED=true
BANKING_PROVIDER_PRIMARY=monnify
BANKING_PROVIDER_FALLBACK=
SUPPORTED_BANKING_CURRENCIES=NGN
BANKING_SANDBOX_MODE=true
MONNIFY_BASE_URL=https://sandbox.monnify.com
MONNIFY_API_KEY=
MONNIFY_SECRET_KEY=
MONNIFY_CONTRACT_CODE=
MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER=
MONNIFY_GET_ALL_AVAILABLE_BANKS=true
MONNIFY_RESTRICT_PAYMENT_SOURCE=false
```

## Operational Next Steps

1. Complete Monnify KYB and obtain sandbox/live credentials.
2. Register `https://YOUR_API_DOMAIN/api/webhooks/monnify` in Monnify.
3. Run `npx prisma migrate deploy` from `BACKEND`.
4. Provision one verified internal user account.
5. Run a low-value sandbox deposit and confirm one wallet credit.
6. Replay the same webhook and confirm no duplicate credit.
7. Create a Monnify exchange deposit instruction from `/dashboard/exchange`, pay with the generated reference, and confirm the webhook marks it provider verified.
8. Confirm finance operators can see the verified deposit under `/admin`, click credit, and reconcile the resulting GHS ledger credit.
9. Add dual-control approval for high-value manual exchange credits before live launch.
10. Add backend e2e/idempotency tests for Monnify duplicate webhook replay and manual receipt duplicate submit/review attempts.
11. Run web e2e smoke for `/dashboard`, `/dashboard/wallet/ngn`, `/dashboard/fund`, `/dashboard/exchange`, and `/admin`.
12. Align Flutter mobile wallet UI with the web `Receive Money` and wallet detail pattern.

## Remaining Launch Blockers

- Monnify dashboard access and credentials are not present in the local repo.
- Public HTTPS webhook URL must be registered and tested from Monnify.
- Staging and production migrations must be applied.
- Supabase private buckets for KYC documents and exchange receipts must be created with MIME/size controls.
- High-value admin approvals currently need dual-control rules before launch.
- Provider reconciliation and export workflows need final operator validation.
