# Production Guide: Reconciliation

## Scope

Use this guide for daily and intra-day reconciliation of wallets, ledger entries, provider events, payment settlements, Paystack deposits and legacy Monnify obligations, withdrawals, VTU purchases, exchange execution, and manual NGN to GHS receipt credits. Local checks can validate formulas, but production requires provider reports and real settlement data.

## Provider and schedule configuration

Use the active [provider source of truth](../PROVIDER-SOURCE-OF-TRUTH.MD), [Paystack acceptance guide](../PAYSTACK-ACTIVATION.md), and provider-specific deployment secrets. Retain Monnify credentials only for legacy obligations. Kora reports are required only for activated Ghana flows. Never place provider credentials in clients or ordinary logs.

`ReconciliationService` schedules wallet reconciliation daily and internal-transfer reconciliation hourly. Verify actual worker execution, timezone, ownership and alert delivery; a documented variable name is not proof that a scheduler or alert integration consumes it. Keep admin-set FX prices authoritative when `FX_RATE_SOURCE=admin`.

## Sandbox Steps

1. Generate test funding, Paystack virtual-account deposit, withdrawal, internal transfer, exchange, manual receipt credit, and VTU records.
2. Run reconciliation and confirm no unmatched ledger entries.
3. Replay a webhook and confirm reconciliation still sees one provider event and one wallet effect.
4. Create a deliberate mismatch and confirm it appears in admin review.
5. Confirm dead-letter events are visible and retryable by authorized admins only.
6. Approve one manual NGN to GHS receipt and confirm the GHS ledger credit ties to the submitted bank reference, receipt URL, admin audit log, and bank or Monnify settlement evidence.

## Live Steps

1. Obtain provider report access for Paystack and VTpass, legacy Monnify obligations, and activated Kora flows where applicable. Admin-set FX rates remain authoritative when `FX_RATE_SOURCE=admin`.
2. Define daily cutoff time, timezone, owner, and sign-off process.
3. Run reconciliation after the first live transaction before broader launch.
4. Compare provider totals, wallet ledger totals, transaction statuses, fees, reversals, and settlements.
5. Record mismatch owner, root cause, resolution, and audit evidence.
6. Keep launch limits low until three consecutive reconciliation cycles are clean.

## Verification Checklist

- [ ] Sum of wallet balances equals expected ledger balance by currency.
- [ ] Every wallet balance mutation has ledger evidence.
- [ ] Every provider success maps to exactly one TRUSTPAY transaction.
- [ ] Every manual receipt credit maps to one bank statement or Monnify settlement evidence item and one admin audit log.
- [ ] Every failed provider transaction has no wallet credit or has a documented reversal.
- [ ] Pending transactions older than SLA are surfaced to admin review.
- [ ] Provider fees and TRUSTPAY fees are separately identifiable.
- [ ] Reconciliation results are retained for audit.
- [ ] DLQ entries have retry, ignore, and escalation policy.

## Launch Blockers

- Provider reports are unavailable or inaccessible to finance owners.
- Wallet, ledger, transaction, and provider totals cannot be tied out.
- Manual NGN to GHS receipt credits cannot be tied to bank reference, receipt evidence, admin reviewer, and settlement record.
- Reconciliation job fails silently.
- No process exists for unmatched deposits, duplicate webhooks, stuck withdrawals, or VTU timeouts.
- No audit retention policy for reconciliation evidence.
