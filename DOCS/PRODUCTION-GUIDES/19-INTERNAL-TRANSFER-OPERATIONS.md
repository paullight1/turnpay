# Internal Transfer Operations

## Release posture

Internal transfers remain disabled unless `INTERNAL_TRANSFERS_ENABLED=true` and an approved, enabled currency/tier policy exists. Production and staging require PostgreSQL, Redis, transaction PIN enforcement, and a 32-byte idempotency-response encryption key before startup.

Production enablement also requires a completed, release-candidate-specific `20-INTERNAL-TRANSFER-CERTIFICATION.md`. An incomplete certification register is a hard launch blocker.

## Paging rules

Page the on-call engineer immediately for any of these structured alert codes:

| Alert code                                 | Severity | Initial action                                                                                         |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------ |
| `REDIS_READINESS_REMOVED`                  | Critical | Remove the instance from traffic; do not enable memory fallback.                                       |
| `RATE_LIMIT_THRESHOLD_EXCEEDED`            | Warning  | Review grouped counts by limiter and route; escalate anomalous spikes.                                 |
| `TRANSACTION_PIN_LOCK_TRIGGERED`           | Warning  | Review aggregate lock rate only; never inspect or request a PIN.                                       |
| `RECIPIENT_ENUMERATION_SIGNAL`             | Warning  | Review aggregate hashed lookup signals by actor/request rate; never attempt to recover the identifier. |
| `INTERNAL_TRANSFER_RECONCILIATION_BLOCKED` | Critical | Freeze new transfers and preserve evidence.                                                            |
| `INTERNAL_TRANSFER_RECONCILIATION_FAILED`  | Critical | Freeze new transfers until a successful zero-mismatch run.                                             |

Configure the log/observability platform to page on the critical codes on the first event. Warning codes should page when their five-minute rate exceeds the approved baseline. Alert routing and thresholds must be exercised in staging before enablement.

## Recipient-preview privacy decision

Unknown, suspended, under-tier, and unverified recipients return the same HTTP 200 `{ "found": false }` contract. Eligible recipients remain distinguishable because the sender must verify a masked counterparty before authorizing an irreversible transfer. Preview is limited independently to 10 requests per minute per trusted client IP and 10 per authenticated user, uses a deterministic 120–150 ms minimum timing window, and emits `RECIPIENT_ENUMERATION_SIGNAL` with only a 12-character identifier digest.

Residual-risk approval status: **PENDING PRODUCT SECURITY APPROVAL**. Production enablement must remain blocked until Product Security records the approver, date, monitoring threshold, review date, and explicit acceptance of the residual fact that a successful eligible lookup is distinguishable from the uniform unavailable response. This document must not be changed to “accepted” without that external approval artifact.

## Incident freeze

1. Set `INTERNAL_TRANSFERS_ENABLED=false` in the deployment secret store and redeploy/restart all instances.
2. Confirm `POST /api/transfers/internal` returns the stable 503 disabled response while preview and history remain available.
3. Do not disable database constraints, Redis checks, PIN checks, idempotency, or reconciliation to restore traffic.
4. Record incident start time, request IDs, transfer references, deployment version, reconciliation run ID, and operators involved.

## Evidence capture

Export the relevant append-only audit entries and reconciliation result. Capture only masked identifiers, request IDs, transfer/reversal references, hashed idempotency digests, transaction IDs, ledger IDs, policy versions, timestamps, and deployment metadata. Do not place PINs, OTPs, bearer tokens, raw idempotency keys, full phone numbers, or encryption material in tickets or chat.

## User communication

Support may state that transfers are temporarily unavailable or under review. Do not promise completion, reversal, or a recovery time until Finance/Ops confirms the ledger state. Reference the support case and transfer reference in the incident record; keep private account data out of shared channels.

## Reversal approval

1. Confirm the original attempt, two transactions, two ledger legs, amount, currency, users, response snapshot, and limit usage are consistent.
2. One administrator requests the reversal with a specific reason and idempotency key.
3. A different administrator reviews the exact amount/currency/users/reference and approves or rejects it.
4. If recipient funds are insufficient, leave the reversal `BLOCKED`; never partially credit the sender or mutate original rows.
5. Confirm the compensating transaction and ledger pair in the next reconciliation run.

## Redis outage

Redis is a required distributed control. Readiness must fail and deployed requests must return 503; per-process memory mode is prohibited. Restore or fail over the managed Redis service, confirm `PING`, verify `/api/health/ready`, then test shared OTP/PIN/rate-limit state across at least two application instances. Do not resume transfers solely because one instance reports live.

## Reconciliation mismatch

Every mismatch count or value is blocking. Diagnose by mismatch code, correct data only through an approved compensating operation or reviewed migration, and preserve original financial rows. Run internal-transfer reconciliation again and require `COMPLETED` with zero mismatches. Also require the daily wallet reconciliation to complete without drift.

## Recovery and re-enable

1. Deploy the reviewed fix with transfers still disabled.
2. Confirm database migrations have zero drift and all production constraints/RLS/grants remain intact.
3. Confirm Redis and database readiness from every instance.
4. Run financial E2E, duplicate/idempotency, concurrency, reversal, and fault-injection checks in staging.
5. Obtain Finance, Risk/Compliance, Security, Operations, and Engineering sign-off.
6. Enable only the approved currency/tier policy and canary cohort, monitor reconciliation and alerts, then expand gradually.

## Retention and access gate

Transfer audit logs, reconciliation runs, and deployment/security events must be retained for at least 90 days in access-controlled storage. Read and export access must be restricted to approved roles and itself audited. Any longer statutory or contractual retention period requires written Compliance approval before production enablement; that approval is an external launch gate, not a code default.
