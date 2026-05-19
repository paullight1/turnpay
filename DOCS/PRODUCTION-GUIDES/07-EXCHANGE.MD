# Production Guide: Exchange

## Scope

Use this guide for NGN/GHS quotes, rate sourcing, quote expiry, execution, fees, and wallet settlement. Local tests can validate arithmetic, but production launch requires live rate source, treasury policy, limits, and reconciliation.

## Required Env Vars

```env
FX_RATE_API_URL=
FX_RATE_API_KEY=
BANKING_ENABLED=false
SUPPORTED_BANKING_CURRENCIES=NGN,GHS
DATABASE_URL=
REDIS_HOST=
REDIS_PORT=6379
REDIS_PASSWORD=
```

## Sandbox Steps

1. Configure a sandbox or test FX rate feed.
2. Generate a quote and confirm source amount, target amount, fee, rate, expiry, and currency pair.
3. Execute quote with `Idempotency-Key`.
4. Confirm source wallet debit and target wallet credit happen in one Prisma transaction.
5. Attempt expired quote, changed rate, insufficient balance, unsupported pair, and duplicate execution cases.
6. Confirm the user sees the locked quote and final settled values.

## Live Steps

1. Approve the production rate source and fallback rate policy.
2. Approve markup, fees, spread, min/max amount, and quote expiry.
3. Configure live `FX_RATE_API_URL` and `FX_RATE_API_KEY`.
4. Enable exchange only for supported currencies and eligible KYC tiers.
5. Execute a low-value staff exchange.
6. Reconcile quote, transaction, ledger debit, ledger credit, fee record, and resulting wallet balances.

## Verification Checklist

- [ ] Quote and execution inputs are DTO-validated.
- [ ] Execution requires `Idempotency-Key`.
- [ ] Quote expiry is enforced server-side.
- [ ] Fee and target amount are calculated server-side.
- [ ] Wallet settlement uses Decimal and a Prisma transaction.
- [ ] Unsupported currency pairs are rejected.
- [ ] Rate source outage produces a controlled error or approved fallback.
- [ ] Admin can review rate, spread, fee, and settlement evidence.

## Launch Blockers

- No approved live FX source or treasury policy.
- Quote can be executed after expiry.
- Client-supplied fee or rate can override server calculation.
- Source debit and target credit can diverge.
- Exchange limits and AML thresholds are undefined.
