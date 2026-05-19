# Production Guide: VTU

## Scope

Use this guide for airtime, data, cable, and electricity purchases through a VTU aggregator such as Reloadly, Shago, TopUp, or the selected provider. Local tests cannot prove live provider inventory, telco settlement, biller validation, or reversal timing.

## Required Env Vars

```env
VTU_API_URL=
VTU_API_KEY=
BANKING_ENABLED=false
DATABASE_URL=
REDIS_HOST=
REDIS_PORT=6379
REDIS_PASSWORD=
```

## Sandbox Steps

1. Configure provider sandbox or test credentials.
2. Load providers and packages from the VTU API.
3. Purchase airtime with `Idempotency-Key`.
4. Confirm wallet debit happens before provider call and reversal happens once on provider failure.
5. Test data, cable, and electricity validation where sandbox supports it.
6. Trigger provider timeout, failed purchase, invalid package, invalid customer, and duplicate request cases.
7. Confirm support can see provider reference and masked customer target.

## Live Steps

1. Approve live aggregator contract, pricing, biller list, settlement terms, and support SLA.
2. Configure live `VTU_API_URL` and `VTU_API_KEY`.
3. Set feature availability by KYC tier, currency, provider, and service type.
4. Execute one low-value airtime transaction on a controlled phone number.
5. Reconcile provider dashboard, TRUSTPAY transaction, ledger debit, reversal status if applicable, and user receipt.
6. Gradually enable data, cable, and electricity after individual live smoke tests.

## Verification Checklist

- [ ] Purchase route requires auth guard, DTO validation, and `Idempotency-Key`.
- [ ] Amount and provider package are server-verified.
- [ ] Wallet debit uses Decimal and a Prisma transaction.
- [ ] Provider failure reverses wallet debit exactly once.
- [ ] Provider timeout does not produce duplicate purchase on retry.
- [ ] Circuit breaker behavior is configured for provider outage.
- [ ] User target identifiers are masked in logs and admin views.
- [ ] Support can distinguish pending, successful, failed, and reversed states.

## Launch Blockers

- Live VTU provider credentials or contract are missing.
- Provider package list cannot be refreshed or cached safely.
- Reversal can credit more than once.
- Timeout handling can create duplicate purchases.
- Biller support and refund process are not documented.
