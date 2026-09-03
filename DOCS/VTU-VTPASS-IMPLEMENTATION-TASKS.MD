# VTU / VTpass Production Readiness

Last reviewed: 2026-09-03

This checklist supersedes the archived multi-provider VTU plan. VTpass is the
only VTU provider, Nigeria is the only enabled market, and all other markets
are disabled as `Coming soon`.

## Implemented

- [x] Nigeria airtime, data, cable change/renew, and prepaid/postpaid
  electricity request contracts.
- [x] Server-side package price, cable renewal amount, smart-card, and meter
  verification.
- [x] E.164 Nigerian phone normalization and explicit contact phone handling.
- [x] Transactional wallet debit with non-negative balance enforcement.
- [x] Idempotency on purchase, validation, requery, and admin mutation routes.
- [x] VTpass success, pending, unknown, failure, refunded, and reversal mapping.
- [x] Provider charge/commission persistence and encrypted purchased-code
  storage with owner-only receipt delivery.
- [x] Durable redacted callback inbox with HMAC-authenticated ingress,
  duplicate suppression, retry/backoff, and admin failure visibility.
- [x] Guarded terminal transitions and exactly-once reversal ledger entries.
- [x] Scheduled order requery and audited manual admin requery.
- [x] Admin provider health, balance warning, stale-order, economics, and
  reconciliation views.
- [x] Website and Flutter Nigeria flows with disabled `Coming soon` markets.
- [x] Production feature flags, fail-closed validation, and live base URL
  `https://vtpass.com/api` in deployment manifests.
- [x] Backend contract/unit tests, website browser test, Flutter service/UI
  tests, and disposable PostgreSQL financial test harness.

## External certification required before launch

- [ ] Obtain and install dedicated VTpass sandbox credentials outside source
  control.
- [ ] Configure the trusted callback gateway described in
  `PRODUCTION-GUIDES/08-VTU.MD`.
- [ ] Execute and retain redacted evidence for every sandbox certification
  matrix row: airtime; data; cable change and renew; prepaid and postpaid
  electricity; pending, unknown, failure, reversal, duplicate, and late-event
  cases.
- [ ] Confirm the VTpass-funded balance, settlement terms, biller catalogue,
  pricing, support SLA, refund workflow, and low-balance alert ownership.
- [ ] Install production credentials in the secret manager, with
  `VTU_SIMULATION_ENABLED=false` and `VTPASS_BASE_URL=https://vtpass.com/api`.
- [ ] Run controlled low-value production smoke transactions for each enabled
  product/mode and immediately reconcile provider, wallet, ledger, order, and
  customer receipt state.
- [ ] Record go/no-go approval from engineering, operations, finance, security,
  and support.

## Rollback gate

If callback authentication, provider state, wallet/ledger reconciliation,
reversal behavior, or purchased-code delivery is uncertain, set
`VTU_ENABLED=false`. Continue callback processing and requery for existing
orders; never resubmit an ambiguous provider purchase.
