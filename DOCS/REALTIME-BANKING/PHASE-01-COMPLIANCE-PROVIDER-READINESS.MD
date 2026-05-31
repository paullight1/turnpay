# Phase 01: Compliance And Provider Readiness

## Goal

Confirm TRUSTPAY can legally and operationally offer wallet-first banking with provider-backed virtual accounts and withdrawals.

## Owners

- Primary: `trustpay-fintech-consultant`
- Reviewers: `trustpay-compliance-aml-officer`, `trustpay-payments-architect`, `trustpay-devops-sre`, `trustpay-project-manager`

## Work Items

- Confirm target countries, launch currency, and provider business eligibility.
- Confirm Paystack and Flutterwave sandbox/live access requirements.
- Confirm KYC fields required for DVA creation.
- Define user-facing wording for virtual accounts and bank-name display.
- Define KYC tiers, transaction limits, restricted users, and manual review thresholds.
- Document provider dashboard setup, webhook URLs, and env vars.

## Deliverables

- Provider readiness checklist.
- Compliance/KYC gating matrix.
- Product copy rules.
- Environment variable matrix.
- Go/no-go decision for sandbox implementation.

## Phase 01 Documents

- `PHASE-01/01-PROVIDER-READINESS-CHECKLIST.MD`
- `PHASE-01/02-COMPLIANCE-KYC-AML-GATING-MATRIX.MD`
- `PHASE-01/03-PRODUCT-COPY-AND-BANK-NAME-RULES.MD`
- `PHASE-01/04-ENVIRONMENT-WEBHOOK-AND-SECRETS-MATRIX.MD`
- `PHASE-01/05-ADMIN-OPS-READINESS-CHECKLIST.MD`
- `PHASE-01/06-GO-NOGO-DECISION-RECORD.MD`
- `PHASE-01/07-DATA-PRIVACY-READINESS.MD`

## Acceptance Criteria

- No "TrustPay Bank" claim remains in planned UI copy.
- Provider account naming and bank display behavior is documented.
- KYC requirements are known before account provisioning work starts.
- Sandbox credentials and webhook setup are separated from production.
- Admin confirmation, audit, and support-readiness requirements are documented before provider sandbox build starts.
- Banking env placeholders exist without real secrets, and sensitive account/KYC data handling is documented.
