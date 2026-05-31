# Phase 07: Frontend, Mobile, And Launch Readiness

## Goal

Expose banking features safely in web, admin, and Flutter mobile after backend contracts and operations tools are ready.

## Owners

- Primary: `trustpay-frontend-mobile-engineer`
- Reviewers: `trustpay-security-risk-engineer`, `trustpay-admin-ops-engineer`, `trustpay-devops-sre`, `trustpay-project-manager`

## User Features

- View virtual account details.
- Copy account number.
- See provider/partner bank name.
- Send to TRUSTPAY user.
- Save beneficiary.
- Withdraw to bank.
- Track transaction status.
- See failed/reversed/pending states clearly.

## Admin Features

- Banking dashboard navigation.
- Confirmation panels.
- Reconciliation tables.
- Provider event details.
- Pending withdrawal queue.
- Risk review queue.

## UX Rules

- Generate `Idempotency-Key` per mutation attempt.
- Disable buttons while submitting.
- Never show "TrustPay Bank" as bank name unless provider/legal approval exists.
- Show pending states for asynchronous provider operations.
- Mask account numbers except when user is viewing their own virtual account details.

## Launch Checklist

- Backend tests pass.
- Web and mobile smoke tests pass.
- Provider sandbox tests pass.
- Webhook HTTPS endpoint is configured.
- Alerts are active.
- Admin runbook is available.
- Incident rollback process is approved.

## Acceptance Criteria

- Users can complete supported flows without ambiguous statuses.
- Admins can confirm and recover operational issues.
- Production launch is blocked until all prior phases are accepted.

