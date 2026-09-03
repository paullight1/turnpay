# Phase 01 Go/No-Go Decision Record

> Historical decision record. Current provider go/no-go criteria apply to Monnify only; see `DOCS/PROVIDER-SOURCE-OF-TRUTH.MD`.

## Decision

Phase 1 is ready for sandbox implementation only after all checklist items below are complete.

Current status: `NOT READY FOR SANDBOX IMPLEMENTATION`

Reason: this document defines the readiness gates, but provider dashboard access, KYC field confirmation, sandbox credential setup, and admin audit decisions still need owner confirmation.

Implementation checkpoint as of May 21, 2026: backend banking foundations have been implemented in later phase files and code, including ledger records, virtual-account APIs, internal transfers, beneficiary storage, withdrawals, provider events, idempotency records, and admin banking endpoints. This does not change the Phase 1 decision. Sandbox provider execution and any live provider configuration remain blocked until the go criteria and required signoffs below are completed.

## Go Criteria

Provider:

- Paystack sandbox keys available.
- Flutterwave sandbox keys available if fallback testing is in scope.
- Provider dashboard webhook URLs configured for staging or tunnel.
- Provider account eligibility and DVA requirements confirmed.
- Supported countries/currencies confirmed for merchant account.
- Exact Flutterwave API version and webhook signature scheme selected.

Compliance:

- KYC tier matrix approved.
- Customer consent language approved for identity validation.
- Transaction limits and manual review triggers approved.
- Product copy rules approved.
- "TrustPay Bank" wording banned unless legal/provider contract changes.

Security:

- Idempotency approach confirmed for all provider mutations.
- Webhook signature verification approach confirmed.
- Provider event storage and replay plan approved.
- Sensitive data masking/encryption plan approved.

Admin/Ops:

- Admin action confirmation pattern approved.
- Audit-log fields approved.
- Support runbooks drafted.
- Provider event visibility planned.
- Typed admin actions planned; no admin workflow requires direct database edits.
- Risk queues planned for provider failures, deposit mismatches, withdrawal risk, KYC/provider identity issues, and AML review.

DevOps:

- Sandbox/live secret separation approved.
- Webhook URL strategy approved.
- Alert categories approved.
- Redis and Postgres availability requirements confirmed.

## No-Go Criteria

Do not start sandbox implementation if any of these are true:

- Provider eligibility is unknown.
- KYC data requirements are unknown.
- Webhook signature verification strategy is unclear.
- Flutterwave docs/code signature assumptions are mixed or unresolved.
- Admin audit plan is missing.
- Product copy still implies TRUSTPAY is the issuing bank.
- Environment variables or secrets would be hardcoded.
- There is no clear owner for provider dashboard configuration.

## Required Signoffs

| Role | Signoff Needed |
|---|---|
| Project Manager | Confirms phase scope and owners. |
| Fintech Consultant | Confirms product position and provider fit. |
| Compliance AML Officer | Confirms KYC, limits, and wording. |
| Payments Architect | Confirms provider flow and webhook events. |
| Security Risk Engineer | Confirms security gates. |
| Admin Ops Engineer | Confirms admin confirmation and audit plan. |
| DevOps SRE | Confirms env, secrets, and webhook setup. |

## Next Action

Move to `READY FOR SANDBOX IMPLEMENTATION` only after the signoff table is completed with named owners and dates.
