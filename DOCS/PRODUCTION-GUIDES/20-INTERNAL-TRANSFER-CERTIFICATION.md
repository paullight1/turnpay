# Internal Transfer Production Certification

## Certification status

**NOT CERTIFIED — DO NOT ENABLE IN PRODUCTION.** Keep `INTERNAL_TRANSFERS_ENABLED=false` until every staging test and approval below is recorded against the exact release candidate.

This document is the release evidence register for the internal-transfer feature. Local automated evidence is necessary but does not replace staging validation on managed infrastructure or approval by the accountable people.

## Release identity

| Item                                      | Value                                               |
| ----------------------------------------- | --------------------------------------------------- |
| Reviewed base commit                      | `ed15922bfe42f6810323924f9137e0ce72b9d1d2`          |
| Release-candidate commit                  | Pending after review and controlled commit          |
| Branch                                    | `codex/trustpay-platform-updates`                   |
| Minimum transfer migration                | `033_sensitive_idempotency_responses`               |
| Feature flag                              | `INTERNAL_TRANSFERS_ENABLED=false`                  |
| Production deployment configuration       | Pending; committed Render blueprint is staging-only |
| Approved currency/tier policy versions    | Pending Risk/Compliance approval                    |
| Managed Redis topology and TLS evidence   | Pending staging evidence                            |
| Multi-instance readiness evidence         | Pending staging evidence                            |
| Database restore point and rollback owner | Pending release record                              |

Any code, schema, environment, policy, or infrastructure change after certification invalidates affected evidence and requires revalidation.

## Local automated evidence

| Check                                                   | Result                                          |
| ------------------------------------------------------- | ----------------------------------------------- |
| Backend unit/integration suites                         | PASS — 52 suites, 354 tests                     |
| Isolated PostgreSQL financial E2E                       | PASS — 2 suites, 10 tests                       |
| Flutter tests                                           | PASS — 102 tests                                |
| Flutter static analysis                                 | PASS — no issues                                |
| Flutter web release build                               | PASS — standard JavaScript build                |
| Flutter transfer integration harness                    | PASS — new-PIN and retry/idempotency paths      |
| Website transfer/privacy Playwright, Chromium viewports | PASS — 20 tests                                 |
| Website smoke Playwright, Chromium viewports            | PASS — 20 tests                                 |
| Complete website Playwright, Chromium viewports         | PASS — 66 tests                                 |
| Public auth forms with JavaScript unavailable           | PASS — 8 desktop/mobile tests; controls inert   |
| Backend build and lint                                  | PASS                                            |
| Website build, type-check, lint, and production CSP     | PASS — production excludes `unsafe-eval`        |
| Financial fixture cleanup                               | PASS — exact-ID cleanup, zero retained fixtures |
| Client HTTP body logging                                | PASS — request and response bodies omitted      |

Local limitations are explicit: Firefox and WebKit were not available locally; the Flutter web result is not a Wasm certification; local PostgreSQL and Redis were single-node development services without managed-service TLS, failover, or multi-instance application routing. The committed Render blueprint is a free-plan staging configuration with sandbox provider endpoints and is not production deployment evidence. CI and staging must supply the missing coverage.

## Staging certification matrix

Every row must contain the release-candidate commit, environment/deployment ID, UTC timestamp, named operator, evidence link, and PASS result.

| Gate                         | Required evidence                                                                                     | Status  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | ------- |
| Exact release deployment     | Image/build digest matches the candidate commit; transfers remain disabled                            | PENDING |
| Database migration and drift | Production-equivalent migration deploy, constraint inspection, zero drift                             | PENDING |
| Backup and restore           | Pre-enable restore point plus successful restore rehearsal and owner                                  | PENDING |
| Managed Redis security       | TLS/auth/private networking and memory fallback disabled                                              | PENDING |
| Redis outage behavior        | All instances fail readiness; mutations return 503; recovery is shared across instances               | PENDING |
| Multi-instance state         | OTP, PIN lock, rate limits, and idempotency behave consistently across at least two instances         | PENDING |
| Transaction PIN matrix       | Create, verify, lockout, reset hold, outage, and retry behavior                                       | PENDING |
| Recipient privacy            | Uniform unavailable response/timing, rate-limit alert, masked successful preview                      | PENDING |
| Policy boundaries            | Only approved currency/tier policies; amount, daily and monthly limits enforced                       | PENDING |
| Idempotency                  | Same key/same payload replays; same key/different payload conflicts; concurrent duplicate debits once | PENDING |
| Concurrency and balances     | Concurrent transfers cannot overdraft or create negative balances                                     | PENDING |
| Commit-response fault        | Post-commit response failure returns recoverably; retry resolves to the original transfer             | PENDING |
| Reversal controls            | Dual control, exact compensating legs, blocked insufficient-recipient case, immutable original        | PENDING |
| Reconciliation               | Internal-transfer and daily wallet reconciliation complete with zero mismatches                       | PENDING |
| Kill switch                  | Disable flag propagates to every instance and blocks new transfer mutation requests                   | PENDING |
| Audit and log privacy        | Financial/admin actions present; no PIN, OTP, token, raw key, full identifier, or body leakage        | PENDING |
| Observability                | Critical pages and warning thresholds exercised end to end                                            | PENDING |
| Browser/accessibility        | Chromium, Firefox, WebKit, mobile viewports, keyboard and screen-reader checks                        | PENDING |
| Security review              | Threat/residual-risk review attached with no unresolved critical/high issue                           | PENDING |

## Required approvals

Agents and test automation cannot grant these approvals. Each approval must identify the person, role, date, release-candidate commit, policy version, conditions, and durable evidence link.

| Approval                                               | Approver/evidence | Status  |
| ------------------------------------------------------ | ----------------- | ------- |
| Engineering owner                                      | Pending           | PENDING |
| Finance/Ledger owner                                   | Pending           | PENDING |
| Operations/on-call owner                               | Pending           | PENDING |
| Product Security — recipient enumeration residual risk | Pending           | PENDING |
| Risk/Compliance — currencies, tiers, limits, retention | Pending           | PENDING |
| Privacy/Data Protection                                | Pending           | PENDING |
| Release manager                                        | Pending           | PENDING |

## Canary and expansion

After all gates and approvals pass, enable only the approved policy and cohort. Record reconciliation and alert evidence at every step.

1. Staff-only cohort for at least 24 hours.
2. Expand to 1%, 10%, 25%, 50%, then 100%; hold each stage for at least one business day.
3. Stop immediately on any unexplained ledger/reconciliation mismatch, duplicate or negative balance, Redis/readiness fault, PIN bypass, PII leak, critical alert, or elevated transfer error rate.
4. Set `INTERNAL_TRANSFERS_ENABLED=false`, preserve evidence, reconcile, and use only approved compensating reversals before considering re-enable.

The authoritative response procedure is `19-INTERNAL-TRANSFER-OPERATIONS.md`. Production status may change to certified only when this register is complete for one immutable release candidate.
