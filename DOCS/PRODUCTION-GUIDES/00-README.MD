# TRUSTPAY production guides

Use these guides with `DOCS/SECURITY-RULES.MD`. Production approval requires evidence for an exact candidate; sandbox success and a healthy API do not establish live provider acceptance.

## Current operational references

| Area | Reference |
| --- | --- |
| Current providers and permitted product scope | [Provider source of truth](../PROVIDER-SOURCE-OF-TRUTH.MD) |
| Paystack funding, dedicated accounts, withdrawals and genuine webhook acceptance | [Paystack activation](../PAYSTACK-ACTIVATION.md) |
| Tier 1 BVN and bank validation, Tier 2 NIN upgrades and audited manual fallback | [KYC guide](../KYC-GUIDE.MD) |
| Ghana activation gates and unsupported payout methods | [Kora Ghana setup](../KORA-GHANA-SETUP.md) |
| Hosting templates and production promotion | [Supabase, Render and Vercel launch](21-SUPABASE-RENDER-VERCEL-LAUNCH.MD) |
| Database, Redis, encrypted backups and restore evidence | [Database and Redis](02-DATABASE-REDIS.MD) |
| Applying and verifying the current migration history | [Migration runbook](20-MIGRATION-RUNBOOK.md) |
| Ledger/provider tie-out and incident review | [Reconciliation](10-RECONCILIATION.MD) |
| Internal transfers and their enablement requirements | [Certification register](20-INTERNAL-TRANSFER-CERTIFICATION.md) and [operations](19-INTERNAL-TRANSFER-OPERATIONS.md) |
| Transactional status email and uncertain-delivery handling | [BVN and account recovery implementation](../implementation/2026-11-03-bvn-account-recovery-and-email.md) |
| Current launch decision and local evidence | [Production checklist](../PRODUCTION-READINESS/2026-11-03-CHECKLIST.md) |

Older platform, Monnify-only, SMS OTP and provider-evaluation guides are historical unless reconciled with these references. New NGN banking uses Paystack; Monnify is retained only for existing obligations. Approved Ninja verification upgrades BVN-verified users with a verified NIN; audited manual evidence review remains the fallback. VTU uses VTpass only.

## Configuration boundaries

- Customer OTP is six-digit Supabase email with a maximum five-minute challenge and three verification attempts. Verify the matching project's templates, SMTP delivery and quotas. Email verification does not grant KYC tiers.
- Transactional status email is a separate outbox transport. `EMAIL_PROVIDER=disabled` queues work without delivery. Configure either SMTP with mandatory TLS or Resend after sender verification; never automatically retry an ambiguous acceptance.
- JWT, database, encryption, storage service-role and provider credentials belong only in the backend secret store. Only publishable configuration may enter `NEXT_PUBLIC_*` variables or Flutter defines.
- Sentry is optional under the owner's current instruction. Structured error logs, financial/admin audit trails, retention and operational alerting remain required.
- `render.yaml` remains staging. `render.production.yaml` is an opt-in paid proposal with live financial features disabled and automatic deployment off. Selecting it does not supply production secrets, provider approvals, backups, managed Redis security or release certification.
- Use the owner's selected production host and verify its actual deployed settings. A repository template does not establish whether a running service uses Render, Dokploy or another approved host.

## Release gates

- [ ] Clean reviewed candidate, matching build digest, full CI and financial/fault regression evidence.
- [ ] Isolated production database, all migrations applied, no unexplained security-advisor findings, private evidence buckets and protected credentials.
- [ ] Persistent authenticated Redis, reviewed network/TLS policy, no memory fallback, and tested multi-instance outage behavior.
- [ ] Genuine signed provider callbacks, independently verified economic outcomes, idempotent retries and low-value reconciled acceptance for every enabled feature.
- [ ] Daily encrypted backups retained for at least 30 days, successful timed restore, tested alerts and named finance/on-call owners.
- [ ] Public mobile security/signing evidence; the Android internal-testing system-TLS exception is not public-release approval.
- [ ] Internal transfers and unactivated Ghana capabilities remain disabled until their respective certification and approval gates pass.
