# Production Guide: VTU

## Scope

Use this guide for airtime, data, cable, and electricity purchases through a VTU aggregator. TRUSTPAY should use VTpass first for Nigeria-focused VTU and bills, then add Reloadly later for global airtime/data and rewards. Local tests cannot prove live provider inventory, telco settlement, biller validation, or reversal timing.

## Required Env Vars

```env
VTU_PROVIDER=vtpass
VTPASS_BASE_URL=https://sandbox.vtpass.com/api
VTPASS_API_KEY=
VTPASS_PUBLIC_KEY=
VTPASS_SECRET_KEY=
RELOADLY_ENABLED=false
RELOADLY_AUTH_URL=https://auth.reloadly.com/oauth/token
RELOADLY_TOPUPS_BASE_URL=https://topups-sandbox.reloadly.com
RELOADLY_AUDIENCE=https://topups-sandbox.reloadly.com
RELOADLY_UTILITIES_BASE_URL=https://utilities-sandbox.reloadly.com
RELOADLY_UTILITIES_AUDIENCE=https://utilities-sandbox.reloadly.com
RELOADLY_CLIENT_ID=
RELOADLY_CLIENT_SECRET=
RELOADLY_SENDER_COUNTRY_CODE=NG
RELOADLY_WEBHOOK_SECRET=
RELOADLY_WEBHOOK_URL=https://api.yourdomain.com/api/webhooks/vtu/reloadly
BANKING_ENABLED=false
DATABASE_URL=
REDIS_HOST=
REDIS_PORT=6379
REDIS_PASSWORD=
```

## Sandbox Steps

1. Configure VTpass sandbox credentials.
2. Load providers and packages from the VTU API.
3. Purchase airtime with `Idempotency-Key`.
4. Confirm wallet debit happens before provider call and reversal happens once on provider failure.
5. Test data, cable, and electricity validation where sandbox supports it.
6. Trigger provider timeout, failed purchase, invalid package, invalid customer, and duplicate request cases.
7. Confirm support can see provider reference and masked customer target.
8. Register the Reloadly sandbox webhook URL and confirm signed duplicate callbacks are idempotent.
9. Confirm Reloadly Utility Payments billers load for Ghana electricity before enabling the UI.

## Live Steps

1. Approve live VTpass contract, pricing, biller list, settlement terms, and support SLA.
2. Configure live `VTPASS_BASE_URL`, `VTPASS_API_KEY`, `VTPASS_PUBLIC_KEY`, and `VTPASS_SECRET_KEY`.
3. Set feature availability by KYC tier, currency, provider, and service type.
4. Execute one low-value airtime transaction on a controlled phone number.
5. Reconcile provider dashboard, TRUSTPAY transaction, ledger debit, reversal status if applicable, and user receipt.
6. Gradually enable data, cable, and electricity after individual live smoke tests.
7. Configure Reloadly live webhooks with `RELOADLY_WEBHOOK_SECRET` before enabling international airtime/data.
8. Configure live Reloadly Utilities URLs/audience before enabling Ghana electricity.

## Verification Checklist

- [ ] Purchase route requires auth guard, DTO validation, and `Idempotency-Key`.
- [ ] Amount and provider package are server-verified.
- [ ] Wallet debit uses Decimal and a Prisma transaction.
- [ ] Provider failure reverses wallet debit exactly once.
- [ ] Provider timeout does not produce duplicate purchase on retry.
- [ ] Reloadly callbacks are signature-verified and logged idempotently.
- [ ] Circuit breaker behavior is configured for provider outage.
- [ ] User target identifiers are masked in logs and admin views.
- [ ] Support can distinguish pending, successful, failed, and reversed states.

## Launch Blockers

- Live VTU provider credentials or contract are missing.
- Provider package list cannot be refreshed or cached safely.
- Reversal can credit more than once.
- Timeout handling can create duplicate purchases.
- Biller support and refund process are not documented.
