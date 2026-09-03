# Production Guide: VTpass VTU

Last reviewed: 2026-09-03

## Supported scope

VTpass is TRUSTPAY's only VTU provider. Nigeria (`NG`, `NGN`) is the only
enabled market for airtime, data, cable TV, and prepaid/postpaid electricity.
Ghana, Kenya, South Africa, the United States, and the United Kingdom must stay
visible but disabled as `Coming soon` until a separately approved rollout.

## Required production configuration

```env
VTU_ENABLED=true
VTU_PROVIDER=vtpass
VTU_SIMULATION_ENABLED=false
VTPASS_BASE_URL=https://vtpass.com/api
VTPASS_API_KEY=
VTPASS_PUBLIC_KEY=
VTPASS_SECRET_KEY=
VTPASS_WEBHOOK_SECRET=
VTPASS_LOW_BALANCE_THRESHOLD=5000
PII_ENCRYPTION_KEY=
```

Never copy live credentials into source control, client applications, logs, or
test fixtures. Production validation rejects simulation mode, missing
credentials, weak callback secrets, and any VTpass base URL other than the
live endpoint above.

## Callback trust boundary

The public TRUSTPAY endpoint is:

```text
POST /api/webhooks/vtu/vtpass
```

VTpass's published transaction-update callback format does not document a
native signature. Do not expose the TRUSTPAY endpoint directly as the VTpass
dashboard callback. Route callbacks through a controlled gateway that:

1. accepts traffic only from the provider controls approved by operations;
2. validates the upstream request using the controls available at deployment;
3. forwards the exact JSON body without mutation; and
4. adds `x-trustpay-vtpass-signature`, an HMAC-SHA256 of the raw body using
   `VTPASS_WEBHOOK_SECRET`.

The backend rejects unsigned, query-token, malformed, and unknown-status
callbacks. It durably records a redacted event before returning success, then
processes it asynchronously with idempotent retries. Never log or expose raw
callback bodies.

## Sandbox certification matrix

Use `https://sandbox.vtpass.com/api` only in a non-production environment with
dedicated sandbox credentials. Record request ID, provider transaction ID,
local transaction/order IDs, wallet before/after, ledger entries, provider
state, and customer-visible receipt for each case.

| Product | Required scenarios |
| --- | --- |
| Airtime | success, pending then requery success, provider failure/reversal, timeout/unknown |
| Data | variation list, valid package purchase, stale/tampered price rejection, pending/requery |
| Cable | customer verification, change package, renew using verified renewal amount, mismatch rejection |
| Electricity | prepaid verification/purchase/token receipt, postpaid verification/purchase, invalid meter/type |
| Cross-cutting | duplicate idempotency key, changed body with same key, duplicate callback, late callback, low balance |

For every successful case, confirm one `VTU_PURCHASE` debit. For each failed or
reversed case, confirm at most one `VTU_REVERSAL` credit and a non-negative
wallet. A pending or unknown result must never be shown as delivered.

## Activation and rollout

1. Apply migration `035_vtpass_vtu_production_completion` and run Prisma
   validation/generation.
2. Run backend unit/build checks, the disposable financial suite, website VTU
   browser coverage, Flutter tests/analyzer, and production manifest checks.
3. Complete every sandbox matrix row and save redacted evidence.
4. Configure the trusted callback gateway and prove duplicate and delayed
   callback delivery.
5. Fund the VTpass wallet, set the low-balance threshold, and assign an alert
   owner.
6. Enable VTU for internal accounts, execute one low-value transaction per
   product/mode, and reconcile immediately.
7. Expand gradually while monitoring error rate, pending age, callback retry
   queue, reversals, provider balance, and ledger drift.

## Incident recovery and rollback

- Disable new purchases with `VTU_ENABLED=false`; do not delete orders or
  ledger rows.
- Keep the scheduled requery and callback workers running so already-debited
  pending orders can reach a terminal state.
- Never resubmit `/pay` for an ambiguous request. Requery by the original
  provider request ID.
- Use the audited admin requery action with a written reason for exceptional
  recovery.
- Reconcile provider charge, commission, customer fee, margin, debit, and any
  reversal before closing an incident.
- Re-enable only after the cause is fixed, callback retries are clear, no
  wallet/ledger drift exists, and a controlled smoke test passes.

## Launch blockers

- Sandbox/live credentials or the trusted callback gateway are unavailable.
- Any retry can duplicate a provider purchase or wallet debit.
- Any failure can miss or duplicate a reversal.
- A late callback can regress a terminal order.
- Package, renewal, or customer verification amounts are accepted from the
  client without server/provider confirmation.
- Purchased codes, secrets, full targets, or raw provider bodies appear in
  logs or admin responses.
