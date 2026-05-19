# Phase 01 Compliance, KYC, And AML Gating Matrix

## Product Position

TRUSTPAY should launch this phase as a wallet-first payment platform using provider-backed virtual accounts. Do not describe TRUSTPAY as a bank unless licensing and partner contracts make that legally true.

## KYC Tiers

| Tier | Status | Required Data | Allowed Capabilities |
|---|---|---|---|
| Tier 0 | Registered, unverified | Email, phone, password | Login, profile, view wallet shell, submit KYC. No virtual account, send, withdraw, or high-risk money movement. |
| Tier 1 | Basic verified | Verified phone/email, legal name, country, date of birth where required | Low-limit wallet funding and internal transfers if provider rules allow. No permanent virtual account if identity validation is required. |
| Tier 2 | Identity verified | Tier 1 plus NIN/BVN or accepted national ID, address where required, provider-required identity fields | Virtual account provisioning, standard internal transfers, withdrawals within limits. |
| Tier 3 | Enhanced review | Tier 2 plus manual compliance approval, business/user risk review, additional source-of-funds evidence when needed | Higher limits, escalated withdrawals, business accounts later. |

## Feature Gates

| Feature | Minimum Gate | Default Limits | Blocked States | Manual Review Triggers |
|---|---|---|---|
| Virtual account provisioning | Tier 2 for provider DVA creation. Required fields must match provider requirements before build. | 1 active virtual account per user per supported currency/provider. NGN only first unless GHS eligibility is confirmed. | `SUSPENDED`, `FRAUD_REVIEW`, `KYC_PENDING`, `KYC_REJECTED`, `KYC_EXPIRED`, `SANCTIONS_MATCH`, unsupported country/currency, provider unavailable. | Name mismatch between TRUSTPAY KYC and provider record, repeated provisioning failures, duplicate assignment, high-risk profile, provider identity validation rejection. |
| Incoming virtual account deposit | Tier 2 for automatic wallet credit. Unknown/unmatched account deposits must not credit automatically. | Tier 2: NGN 500,000/day and NGN 2,000,000/month. Tier 3, if later approved: NGN 5,000,000/day and NGN 20,000,000/month. | `SUSPENDED`, `FRAUD_REVIEW`, `SANCTIONS_MATCH`, inactive/closed virtual account, unsupported currency, invalid webhook signature. | Amount/currency/account/reference mismatch, duplicate provider reference, above threshold, unusual velocity, third-party sender risk, provider event replay after prior success. |
| Internal transfer | Tier 2 for sender and recipient. Both wallets must be active and same supported currency. | Tier 2: NGN 250,000/transaction, NGN 1,000,000/day, NGN 5,000,000/month. Tier 3: NGN 1,000,000/transaction, NGN 5,000,000/day. | Sender or recipient `SUSPENDED`, `FRAUD_REVIEW`, `KYC_REJECTED`, `SANCTIONS_MATCH`, insufficient balance, negative-balance risk. | Amount above threshold, rapid repeated transfers, circular transfers, new account sending after first deposit, recipient recently changed identifiers, idempotency/race conflict. |
| Withdrawal | Tier 2 minimum. Tier 3 required for higher limits or high-risk destinations. Beneficiary must be resolved and saved or resolved inline before payout. | Tier 2: NGN 200,000/transaction, NGN 500,000/day, NGN 2,000,000/month. Tier 3: NGN 1,000,000/transaction, NGN 5,000,000/day. | `SUSPENDED`, `FRAUD_REVIEW`, `KYC_PENDING`, `KYC_REJECTED`, `SANCTIONS_MATCH`, unresolved/deleted beneficiary, provider unavailable. | First withdrawal to new beneficiary, beneficiary name mismatch, withdrawal soon after deposit, above threshold, repeated provider failures, ambiguous provider status, high-risk destination, velocity spike. |
| Admin override | Admin role plus explicit approval policy. Financial overrides require dual control for production. | Manual wallet adjustment cap: NGN 100,000 per action without senior approval. Above cap requires second admin approval and documented reason. | Admin lacks `ADMIN`, missing reason code, no audit trail, sanctions match, unresolved provider mismatch. | Manual credit/debit, limit override, KYC override, releasing held funds, transaction status change, retrying/reversing payout, disabling fraud block. |

## Global Manual Review Triggers

| Trigger | Required Action |
|---|---|
| Sanctions/watchlist possible match | Freeze banking actions pending compliance review. |
| KYC name mismatch with provider/account beneficiary | Hold provisioning, deposit credit, or withdrawal until resolved. |
| Deposit or withdrawal exceeds configured threshold | Move to `PENDING_REVIEW`; do not auto-complete. |
| Duplicate webhook/reference/idempotency conflict | Do not move funds again; investigate provider event history. |
| Suspicious velocity, circular transfers, or rapid deposit-to-withdrawal pattern | Temporarily restrict money movement and open AML review. |
| Provider status mismatch or ambiguous transfer state | Hold final wallet state until verified/reconciled. |
| Admin manual credit/debit request | Require audit reason, reference, and second approval above cap. |

## AML And Fraud Rules Required Before Launch

- Suspended users cannot provision accounts, send, receive, or withdraw where policy requires blocking.
- Failed KYC users cannot receive virtual accounts.
- Every money movement must have user, wallet, reference, amount, currency, status, and audit trail.
- High-risk or suspicious activity should create an admin risk review item instead of silently proceeding.
- Reversals and releases require reason capture and admin audit.
- Support staff must not ask users for OTPs, passwords, full BVN/NIN, or card secrets.

## Compliance Blockers

- No provider go-live approval.
- No customer consent language for provider identity validation.
- No KYC fields sufficient for provider DVA creation.
- No retention/masking plan for identity and account details.
- No AML review policy for suspicious activity.
- No admin audit log for manual actions.
- No double-entry ledger or reconciliation plan for production launch.
- No maker-checker policy for high-risk admin overrides.
