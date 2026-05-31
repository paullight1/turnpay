# Phase 01 Admin Ops Readiness Checklist

## Purpose

Make sure admin operations are designed before provider sandbox implementation begins.

Status: `NOT READY FOR SANDBOX IMPLEMENTATION` until Phase 1 admin/ops gates are signed off.

## Admin Capabilities Required By Later Phases

| Capability | Needed By | Phase 1 Decision |
|---|---|---|
| View virtual account provisioning status | Virtual accounts | Required before sandbox DVA testing. |
| View provider events | Deposits and withdrawals | Required before processing webhooks. |
| View pending deposits | Deposits | Required before sandbox deposit testing. |
| View pending withdrawals | Withdrawals | Required before transfer testing. |
| Retry provider verification | Deposits and withdrawals | Required before launch, sandbox recommended. |
| Run reconciliation | Operations | Required before production. |
| Record admin action reason | All manual operations | Required. |
| View audit logs | Security and support | Required. |

## Admin Panels To Exist Or Be Planned

- [ ] Banking Overview planned with provider health, pending counts, stale items, failed webhook count, and reconciliation mismatch count.
- [ ] Virtual Accounts panel planned before sandbox DVA testing.
- [ ] Provider Events panel planned before webhook processing.
- [ ] Deposits panel planned before sandbox deposit testing.
- [ ] Withdrawals panel planned before sandbox transfer testing.
- [ ] Risk Review queue planned for AML/manual review triggers.
- [ ] Reconciliation panel planned before production; sandbox visibility recommended.
- [ ] Audit Logs panel planned and queryable by admin/support/security.
- [ ] Settings and Limits panel planned for later limit/KYC controls, with maker-checker policy for high-risk overrides.

## Admin API And Access Requirements

- [ ] All admin routes require `JwtAuthGuard`, `RolesGuard`, and `ADMIN`.
- [ ] All admin mutation endpoints require DTO validation and `Idempotency-Key`.
- [ ] Admins must not directly edit `Transaction.status`.
- [ ] Admin operations must call typed service actions such as verify, hold, release, reverse, retry, ignore, suspend, and unsuspend.
- [ ] Full account numbers, BVN/NIN, secrets, provider keys, OTPs, and raw signatures must never appear in admin tables, logs, or exports.
- [ ] All money-affecting actions must be exactly-once and backed by transaction-safe service logic.

## Confirmation Patterns

Every high-risk admin action must show:

- Actor admin.
- Target user.
- Target reference.
- Current status.
- Intended action.
- Intended target status, if status-changing.
- Amount and currency, if money-related.
- Provider and provider reference, if applicable.
- Latest provider status, if applicable.
- Required reason.
- Clear irreversible-action warning where relevant.
- Optional second-admin approval for high-risk actions.
- Final confirmation button with clear action text.

Actions requiring confirmation:

- Verify pending provider status.
- Retry provider verification.
- Retry webhook processing.
- Reverse failed withdrawal.
- Release held transaction.
- Mark provider event ignored.
- Suspend or unsuspend user.
- Change KYC status.
- Change user limits.
- Ignore provider event.
- Manual wallet adjustment, if ever added.

## Audit Log Minimum Fields

- `id`
- `adminId`
- `action`
- `targetType`
- `targetId`
- `reference`
- `reason`
- `before`
- `after`
- `metadata`
- `createdAt`

Audit coverage:

- [ ] Financial transaction status changes.
- [ ] Provider retries, webhook replays, ignored events.
- [ ] Reversals, releases, holds, manual reviews.
- [ ] KYC status changes.
- [ ] User suspension/unsuspension.
- [ ] Limit changes.
- [ ] Admin authentication failures and rate-limit triggers.
- [ ] No full account numbers, raw identity values, tokens, secrets, or passwords in audit metadata.

## Risk Queues To Define

- [ ] Provider event failure queue: failed webhook processing, invalid signature spike, event received but not processed.
- [ ] Deposit mismatch queue: amount, currency, account, reference, duplicate provider reference, unknown/unmatched account deposit.
- [ ] Withdrawal risk queue: pending beyond SLA, ambiguous provider status, failed/reversed transfer, first withdrawal to new beneficiary, beneficiary name mismatch.
- [ ] KYC/provider identity queue: name mismatch, provider identity validation rejection, repeated DVA provisioning failure.
- [ ] AML/manual review queue: sanctions/watchlist possible match, suspicious velocity, rapid deposit-to-withdrawal pattern, circular transfers, above-threshold transaction.
- [ ] Each queue item has owner, SLA age, recommended action, current status, reason history, and audit trail.

## Support Runbook Requirements

Support staff need scripts for:

- User says bank transfer was sent but wallet not credited.
- User says withdrawal is pending too long.
- User sent money to wrong TRUSTPAY user.
- User sees a bank name that is not TRUSTPAY.
- User's virtual account provisioning failed.
- Provider webhook arrived but processing failed.
- Provider dashboard shows success but TRUSTPAY status is pending.
- Provider dashboard shows failure after wallet debit.
- Support script states TRUSTPAY is a wallet platform, not the issuing bank.
- Support staff must not ask users for OTPs, passwords, full BVN/NIN, card secrets, or full account numbers.

## Phase 1 Go/No-Go Checks

Go only when:

- [ ] Admin confirmation pattern is approved.
- [ ] Audit-log fields and retention/masking rules are approved.
- [ ] Provider event visibility is planned before webhook testing.
- [ ] Virtual account provisioning visibility is planned before DVA sandbox testing.
- [ ] Pending deposit visibility is planned before sandbox deposit testing.
- [ ] Pending withdrawal visibility is planned before transfer sandbox testing.
- [ ] Support runbooks are drafted.
- [ ] Role-based admin access is planned.
- [ ] No admin workflow requires direct database edits.
- [ ] Product/support copy does not imply "TrustPay Bank".
- [ ] Idempotency, DTO validation, auth guards, and audit logging are required for every admin mutation.
- [ ] Named signoff exists from Admin Ops Engineer, Security Risk Engineer, Compliance AML Officer, Payments Architect, DevOps SRE, Fintech Consultant, and Project Manager.

No-go if any are true:

- [ ] Admin audit plan is missing.
- [ ] Typed admin actions are missing.
- [ ] Reason capture is missing.
- [ ] Provider event visibility is missing.
- [ ] Role-based admin access is missing.
- [ ] Support copy cannot explain provider/partner bank names.
- [ ] Webhook signature verification strategy is unclear.
- [ ] Environment variables or secrets would be hardcoded.

## Phase 1 Admin Blockers

- No audit-log plan.
- No typed admin actions.
- No reason capture.
- No provider event visibility.
- No support copy explaining provider/partner bank names.
- No role-based admin access.
