# 07 — Staging Certification and Go-Live

## Goal

Prove the complete product works end to end before exposing it to real customers.

## Owner

Release manager with engineering, finance, compliance, support, security, and provider owners.

## Steps

- [ ] Freeze the release candidate commit and record backend, website, mobile, migration, and dependency versions.
- [ ] Deploy the exact candidate to staging using production-like infrastructure and configuration, but sandbox providers and test accounts.
- [ ] Execute the full customer journey: registration, OTP, KYC, wallet funding, exchange, internal transfer, VTU purchase, withdrawal, failure, refund, reversal, support, and logout.
- [ ] Execute failure drills: duplicate requests, duplicate webhooks, delayed webhooks, provider outage, database restart, Redis restart, insufficient funds, and reconciliation mismatch.
- [ ] Verify every critical event produces the expected customer state, ledger state, provider state, audit record, notification, and support trace.
- [ ] Run accessibility, browser/device compatibility, performance, load, rate-limit, backup-restore, and incident-response checks.
- [ ] Hold a go/no-go meeting. Record every open issue, risk owner, workaround, expiry date, and decision.
- [ ] Launch with a small canary cohort, low limits, enhanced monitoring, manual settlement review, and a predefined rollback trigger.
- [ ] Expand traffic only after the first settlement and reconciliation cycle is clean.

## Evidence required

Release manifest, staging test report, provider test references, reconciliation report, load results, restore results, go/no-go decision, canary metrics, and post-launch review.

## Exit criteria

All critical scenarios pass, all launch blockers are closed or formally accepted, owners are on call, rollback is ready, and the canary completes a clean settlement/reconciliation cycle.
