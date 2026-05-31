# Team And Async Workflow

## Required Expert Roles

Core roles already created as repo-local skills:

- `trustpay-project-manager` - sequencing, dependencies, acceptance criteria, handoffs.
- `trustpay-fintech-consultant` - product/compliance posture, provider fit, launch risk.
- `trustpay-payments-architect` - Paystack/Flutterwave flows, webhooks, provider contracts.
- `trustpay-ledger-backend-engineer` - Prisma transactions, ledger, Decimal-safe money movement.
- `trustpay-security-risk-engineer` - auth, fraud, webhook spoofing, idempotency, audit.
- `trustpay-reconciliation-qa-engineer` - test matrix, provider mismatch, replay, reversal coverage.
- `trustpay-frontend-mobile-engineer` - web/mobile UX, account display, KYC gates, idempotent submissions.
- `trustpay-devops-sre` - environments, secrets, monitoring, webhooks, deployment, incident response.

Additional roles added for banking completeness:

- `trustpay-admin-ops-engineer` - admin panels, confirmations, operations queue, manual review tooling.
- `trustpay-compliance-aml-officer` - KYC tiers, AML holds, transaction monitoring, licensed-bank wording.
- `trustpay-data-privacy-engineer` - account-number encryption, masking, retention, logs, privacy-safe exports.

## Ownership Matrix

| Area | Primary Owner | Required Reviewers |
|---|---|---|
| Provider readiness | Fintech Consultant | Payments Architect, Compliance AML |
| Data model | Ledger Backend | Security Risk, Reconciliation QA, Data Privacy |
| Virtual accounts | Payments Architect | Ledger Backend, Compliance AML, Admin Ops |
| Internal transfers | Ledger Backend | Security Risk, Reconciliation QA |
| Withdrawals | Payments Architect | Ledger Backend, Admin Ops, Security Risk |
| Admin panels | Admin Ops | Security Risk, Frontend Mobile, Reconciliation QA |
| Reconciliation | Reconciliation QA | Ledger Backend, DevOps SRE |
| Frontend/mobile | Frontend Mobile | Security Risk, Project Manager |
| Deployment | DevOps SRE | Security Risk, Project Manager |

## Async Rules

- Each role writes assumptions and blockers before implementation.
- Each phase starts with API/data contracts and acceptance criteria.
- No role performs live provider provisioning without explicit approval.
- Backend money movement changes cannot merge without Security Risk and Reconciliation QA signoff.
- Frontend cannot ship submit flows unless idempotency keys are generated and buttons disable during mutation.
- Admin action screens cannot ship without confirmation, reason capture, and audit log support.

## Handoff Format

Every role handoff must include:

- Scope completed.
- Files or interfaces affected.
- Assumptions made.
- Decisions locked.
- Risks remaining.
- Tests or checks required.
- Next owner.

## Release Gate

Before live banking launch:

- Compliance AML approves product wording and KYC gates.
- Payments Architect confirms provider live readiness.
- Security Risk confirms auth, idempotency, signatures, and audit logs.
- Reconciliation QA confirms duplicate, replay, reversal, and mismatch tests.
- Admin Ops confirms review queues and manual recovery flows.
- DevOps SRE confirms alerts, backups, webhooks, and incident runbooks.

