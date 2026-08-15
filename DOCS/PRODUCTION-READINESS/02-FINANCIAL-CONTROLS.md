# 02 — Financial Controls and Ledger Safety

## Goal

Guarantee that customer balances, ledger entries, fees, reversals, and admin actions remain correct and auditable.

## Owner

Finance-control owner, backend lead, and an independent operations reviewer.

## Steps

- [ ] Apply all Prisma migrations in staging and confirm migration drift is zero.
- [ ] Verify every balance mutation uses one Prisma transaction, Decimal arithmetic, idempotency, and a non-negative balance guard.
- [ ] Run concurrent debit, duplicate payment, duplicate webhook, delayed webhook, reversal, refund, insufficient-funds, currency-mismatch, and rounding tests.
- [ ] Run the persisted reconciliation job and review `ReconciliationRun` records. Any mismatch must produce `BLOCKED`, an alert, and a settlement hold.
- [ ] Reconcile wallet balances to ledger entries, provider events to transactions, bank settlements to deposits, and payout status to provider status.
- [ ] Verify high-risk admin operations require a separate approver, reject self-approval, expire old approvals, and write before/after audit records.
- [ ] Confirm immutable retention for transactions, ledger entries, provider evidence, and audit logs.
- [ ] Have finance independently sample transactions from staging and sign the control checklist.

## Evidence required

Migration output, reconciliation reports, test logs, sample ledger tie-outs, approval records, audit-log samples, and finance sign-off.

## Exit criteria

Zero unexplained reconciliation differences, no negative balances, deterministic retry behavior, and finance approval for the launch threshold and settlement process.
