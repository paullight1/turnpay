# F6 VTU action-required recovery — 2 November 2026

## Scope

VTU provider checks now have an explicit exhausted-work state with a durable `actionRequiredAt` marker added in migration 051 during integration. An unresolved `PENDING`, `PROCESSING`, or `UNKNOWN` order at
12 provider checks remains unresolved and keeps its debit reserved. The system
does not refund, resend, create a replacement purchase, or mark fulfillment
successful merely because the retry limit was reached.

## Durable recovery state

- Every unresolved provider failure or pending response increments
  `requeryAttempts`, including the initial provider response and later requery
  responses.
- At the threshold, `nextRequeryAt` is cleared and a unique
  `PaymentNotification` event key (`vtu:requery-exhausted:<orderId>`) is
  inserted for the admin audience. The first insertion also writes an
  append-only `AuditLog` action `VTU_REQUERY_EXHAUSTED`; retries cannot duplicate
  the escalation.
- Threshold updates are guarded by unresolved transaction/order predicates.
  Provider calls remain outside database transactions; late terminal outcomes
  remain authoritative and transient updates cannot regress them.
- The scheduler queries due normal checks separately from a bounded backfill of exhausted rows whose `actionRequiredAt` is null; it never calls the provider for those rows. Customer
  requery is blocked at the threshold, while the existing audited admin requery
  path remains available with an explicit recovery reason.

## Customer/admin surfaces

- Customer order status exposes `actionRequired`, a stable action code, and
  support guidance that preserves the original reference and warns against a
  replacement purchase.
- The admin stale-order queue directly queries exhausted unresolved orders so
  old exceptions cannot be hidden by a recent-row sample. The reconciliation
  report includes the same direct threshold query and marks the exception.
- Admin VTU UI shows an action-required count/badge and supervised manual
  requery guidance. After a manual check, an unresolved order remains in the
  queue until genuine provider evidence or an independently reviewed terminal
  resolution exists.

## Verification

- VTU service tests: 52 passed (117 across the full `src/vtu` suite).
- Admin service tests: 28 passed.
- Scoped backend ESLint and production-scope TypeScript (`tsconfig.build.json`,
  no emit): passed.
- Website ESLint and production build: passed.
- Initial worker verification performed no migration. Root integration later added migration 051 and verified it only against the disposable financial test database; no live database, deployment or commit was performed. See the final remediation report for authoritative combined counts.

## Remaining boundary

The admin requery is a supervised provider check, not a refund or resend
workflow. A provider result that remains unknown still requires operations to
reconcile the original reference and follow the separately reviewed financial
resolution process.

## Integration follow-up

A PostgreSQL regression with 30 exhausted rows plus one due legacy row and a batch limit of 10 caught starvation in the initial single-queue query. Separate bounded batches and the persisted escalation marker fix it: all 30 alerts/audits are created once and the due original operation completes. Legacy success/pending contradictions become held action-required orders rather than automatic refunds; an independent provider success repairs the transaction. The final result and rollout instructions are in [Money-flow fixes](/Users/MAC/Desktop/Desktop/app-projects/TRUSTPAY/DOCS/MONEY-FLOW-FIXES-2026-11-02.md).
