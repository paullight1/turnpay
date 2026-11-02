# TRUSTPAY KYC: BVN first, NIN upgrade

Updated: 2 November 2026. This supersedes the previous Monnify-first onboarding instructions; retain legacy provider identities and unfinished obligations.

## Customer journey

1. A new Nigerian customer reviews their legal profile, supplies BVN and a linked Nigerian bank account, and records Paystack verification consent. Bank-account preparation has separate consent.
2. A genuine successful Paystack identity result earns Tier 1. Request acceptance, a timeout or a client refresh does not verify identity. With account consent, receiving-account preparation follows independently; show ready details only after provider confirmation.
3. Tier 1 is eligible for supported transfers, withdrawals, bills and exchange within its configured limits. Provider/product availability, suspension, transaction PINs, settlement holds, destination checks and tighter action-specific limits still apply.
4. A verified NIN in addition to BVN earns Tier 2. New NIN-only approvals do not activate Tier 1. Existing earned tiers are not bulk downgraded. Pending or rejected NIN never removes earned Tier 1 access.

Web and Flutter use Verify BVN, View verification status, and Upgrade to Tier 2 consistently. Customer web remains retired in production; retained web pages can render only in the existing local QA mode. No customer web relaunch is part of this change.

## Automated NIN

Paystack stays the BVN provider (`KYC_PROVIDER=paystack`). Ninja is the approved NIN match-only provider; the owner confirmed approval on 2 November 2026. The existing live credential was checked through Ninja's read-only account endpoint, and local NIN configuration was enabled. No customer identity was submitted in that check.

```dotenv
NINJA_NIN_ENABLED=false
NINJA_SECRET_KEY=
NINJA_BASE_URL=https://api.ninja.boucloud.io
```

The example remains disabled until a key is supplied. Approved local/deployment configuration uses `NINJA_NIN_ENABLED=true`. `NINJA_SECRET_KEY` is the canonical server setting; the previous local `NINJA_CLIENT_SECRET` was migrated without exposing it. The public client key and browser session-token flow are not needed for backend verification. The Render blueprint includes the live URL, enable flag and a secret-only environment entry; updating this file does not deploy or install the secret remotely.

Use the documented sandbox host and separate sandbox key for local/provider testing. Production rejects the sandbox host/key for readiness. Credentials stay server-side. The adapter uses `POST /api/identity/identify` in verify mode with legal first/last name and date of birth, strict required fields and an internal document reference. It requires complete exact match evidence, stores only a sanitized result and never retrieves a registry record for storage or logging.

The backend reports `ninVerificationAvailable` in `GET /api/kyc/status`. The UI only offers automated verification when ready; otherwise the explicitly labeled private document-review path remains. Inconclusive Ninja results require support/review; an administrator cannot manually approve an automated result. Reject an inconclusive automated check before collecting separate manual evidence. Existing manual submissions remain attached to their original evidence and review history.

Current provider contract: https://www.ninja.ng/docs/ . Do not copy the old removed adapter's short-lived-token assumptions into server-to-server calls.

## Tier 1 limits and activation

No production amounts are supplied by this change. The owner/licensed partner approves these positive NGN decimal strings and operations installs them through the audited release/configuration process:

```dotenv
TIER_ONE_NGN_PER_TRANSACTION=
TIER_ONE_NGN_DAILY=
TIER_ONE_NGN_MAX_BALANCE=
```

All three must be present and valid, and daily must be at least the per-transaction limit. Missing or malformed policy fails closed. These fields do not authorize a regulated product or enable a disabled provider. A separate active Tier 1 internal-transfer policy must also be created and approved through the existing admin policy workflow; its tighter per-transfer/daily/monthly caps continue to apply.

The common ledger checks the policy under a wallet row lock in the same database transaction as the movement. Covered debits, direct manual exchange orders and legacy external exchange receipts share the daily allowance. The daily period starts at 00:00 UTC, matching existing withdrawal counter conventions. Pending spending consumes allowance; original transactions explicitly marked FAILED/REVERSED no longer consume it. Direct exchange instructions reserve their value until rejected or the daily period ends; expiry alone does not prove an external transfer did not occur. This conservative behavior prevents releasing an ambiguous external payment reservation.

Incoming non-compensating credits cannot exceed Tier 1 maximum balance. An over-limit provider receipt stays uncredited in the existing receipt/inbox/reconciliation workflow; do not discard it, mark received money unpaid, or create an unrelated replacement credit. Refunds, reversals and operator-authorized adverse-funding recovery retain their original accounting protections and are not stranded by these new customer-spend caps.

The BVN-first policy is NGN-scoped. It does not activate Ghana services or bypass Ghana/cross-border product requirements. Tier 1 cannot settle exchange proceeds into a GHS wallet; unsupported legacy receipt paths reject before accepting payment evidence. Supported bank/MoMo delivery orders retain their own availability and destination checks. Existing Tier 2 action limits and historic provider obligations remain.

## Evidence and operations

Identifiers remain encrypted and masked. All mutations retain JWT/role checks, DTO validation, rate limiting, idempotency and audit trails. Private uploads and expiring reviewer links are retained. A manual NIN approval requires sufficient authorized verification evidence; visually approving a slip alone is not proof of NIMC validation.

See PAYSTACK-ACTIVATION.md for merchant access, callback delivery and separate account preparation, and KYC-RECOVERY-OPERATIONS.md for existing unresolved BVN checks and manual review operations. Local tests use synthetic customers and fake external providers. They do not certify live Paystack/Ninja access or approve a real identity.
