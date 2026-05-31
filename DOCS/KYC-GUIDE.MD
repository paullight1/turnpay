# TRUSTPAY KYC Verification Guide

Last reviewed: 2026-05-21

This guide defines the minimum KYC setup needed before enabling TRUSTPAY money movement in Nigeria-focused flows.

## Current Security Posture

- Money movement routes already require authenticated users and transaction PIN checks where applicable.
- Withdrawals, internal transfers, virtual-account provisioning, deposits, beneficiary management, and VTU purchases are gated by `kycStatus === VERIFIED` and at least `TIER_2`.
- KYC identifier values are treated as sensitive PII. New submissions are encrypted with `PII_ENCRYPTION_KEY`, and API responses return masked identifiers only.
- KYC document upload uses Supabase Storage signed upload tokens. The application stores only private object keys and mints short-lived admin review URLs.
- KYC submissions create a `KycVerification` record through a provider gateway. The default gateway is manual review until a licensed/contracted BVN/NIN provider is configured.
- Admin KYC decisions require a review reason and create an `AuditLog` entry.

## Regulatory Baseline

Use counsel/compliance review before production launch. As implementation anchors:

- CBN BVN guidance says BVN supports KYC effectiveness and a safe payment system.
- CBN notes that individual Tier 2 and Tier 3 accounts/wallets require BVN and NIN, while Tier 1 requires either BVN or NIN.
- CBN Customer Due Diligence Regulations, 2023 require customer identification, identity verification, ongoing due diligence, and enhanced due diligence for higher-risk customers/transactions.
- NIBSS Financial Authentication Service provides centralized BVN, vNIN, and NIN validation APIs through the NIBSS Developer Portal.

References:

- CBN BVN page: https://www.cbn.gov.ng/PaymentsSystem/BVN.html
- CBN Customer Due Diligence Regulations, 2023: https://www.cbn.gov.ng/Out/2023/CCD/CBN%20Customer%20Due%20diligence%20Reg.%202023-combined.pdf
- NIBSS Financial Authentication Service: https://nibss-plc.com.ng/nvs/
- NIBSS BVN service: https://nibss-plc.com.ng/bank-verification-numberbvn/

## Recommended KYC Tiers

| Tier   | Required Data                                                                                  | Allowed Capabilities                                                  |
| ------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Tier 0 | Email, phone, password, transaction PIN                                                        | Login, view wallet shell, submit KYC                                  |
| Tier 1 | Valid BVN or valid NIN, phone/email matched where provider supports it                         | Low-risk wallet access only; no external withdrawals                  |
| Tier 2 | BVN and NIN verified, legal name/date of birth match profile, document/selfie review if needed | Internal transfers, VTU, standard withdrawal limits, virtual accounts |
| Tier 3 | Tier 2 plus proof of address, source-of-funds/occupation, enhanced review                      | Higher limits and exception handling                                  |

For TRUSTPAY launch, use Tier 2 as the minimum for transfers, withdrawals, and virtual-account provisioning.

## Provider Setup

1. Open a NIBSS Developer Portal relationship for Financial Authentication Service access.
2. Request sandbox and production credentials for BVN validation, NIN validation, and vNIN validation.
3. Confirm contract terms for storing returned identity attributes. Store the minimum needed for audit and risk decisions.
4. Store provider credentials only in environment variables or a secret manager.
5. Use the implemented `KycProviderGateway` abstraction before wiring provider code:
   - `verifyBvn(input)`
   - `verifyNin(input)`
   - `verifyVirtualNin(input)`
   - `normalizeProviderResult(result)`
   The current implementation uses `ManualKycProvider`, which deliberately does not fake BVN/NIN verification.
6. Persist verification outcomes separately from raw submitted numbers:
   - masked identifier
   - provider reference
   - match result
   - watchlist/sanctions flags where legally available
   - reviewed/admin decision metadata

### Manual Provider Default

`ManualKycProvider` is the default provider because TRUSTPAY must not simulate BVN, NIN, or vNIN verification without a licensed provider relationship. It creates reviewable KYC records and keeps money movement behind manual/admin approval until production-grade identity verification is legally and technically available.

To replace it, keep the `KycProviderGateway` contract stable and add a licensed provider adapter, such as NIBSS/NIMC through an approved institutional relationship, Monnify identity APIs where contractually supported, or another approved KYC provider. The adapter must verify identifiers with provider credentials from environment variables or a secret manager, normalize provider responses, redact raw payloads before logging, persist only the minimum required verification evidence, and keep manual review as the fallback for mismatch, timeout, sanctions/risk flags, or ambiguous provider responses.

## Supabase Document Storage

TRUSTPAY expects a private Supabase Storage bucket for identity documents.

Environment:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
KYC_DOCUMENT_BUCKET=kyc-documents
KYC_ADMIN_DOCUMENT_URL_TTL_SECONDS=300
```

Setup:

1. Create the `kyc-documents` bucket as private.
2. Restrict bucket MIME types to `image/jpeg`, `image/png`, `image/webp`, and `application/pdf`.
3. Set the bucket file-size limit to 8 MB or lower.
4. Keep `SUPABASE_SERVICE_ROLE_KEY` only on the backend.
5. Do not make KYC documents public. Supabase private bucket assets should be served only through server-created time-limited signed URLs.

Implemented flow:

1. User requests `POST /api/kyc/document-upload-url`.
2. Backend creates a server-controlled object key under `kyc/{userId}/...`.
3. Browser uploads to Supabase with the returned signed token.
4. User submits `POST /api/kyc/submit` with the object key.
5. Admin review receives a short-lived signed read URL, not a permanent public URL.

Reference: Supabase signed upload URLs are generated with `createSignedUploadUrl`, and private objects are shared through time-limited `createSignedUrl` links.

## Third-Party API Notes

| Provider             | Required practice before production                                                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NIBSS/NIMC           | Complete institutional onboarding for BVN, NIN, and vNIN verification. Do not fake provider verification; keep manual review until credentials are active.                                                                               |
| Monnify              | Capture and verify BVN or NIN before reserving virtual accounts. Monnify guidance says new virtual-account flows should supply BVN/NIN, and maximum limits require both where applicable. TRUSTPAY virtual-account creation now reuses verified BVN/NIN already stored from KYC when DTO values are absent, instead of asking the user to re-enter identifiers during account provisioning. |
| Monnify webhooks     | Validate `monnify-signature`, deduplicate provider events, and acknowledge quickly before heavy processing.                                                                                                                              |
| Paystack webhooks    | Validate `x-paystack-signature` using HMAC SHA-512 and keep webhook processing idempotent.                                                                                                                                               |
| Flutterwave webhooks | Use the selected Flutterwave API generation consistently. Current docs describe HMAC-SHA256 over the raw body with `flutterwave-signature`; older docs use `verif-hash`, so production must configure and test the exact dashboard mode. |
| Reloadly             | Use OAuth client-credentials token flow with sandbox/live credentials separated. Cache tokens in Redis and do not log client secrets or access tokens.                                                                                   |

## Data Handling Rules

- Never log BVN, NIN, document URL tokens, access tokens, or full identity payloads.
- Encrypt all national identifiers at rest with `PII_ENCRYPTION_KEY`.
- Return masked identifiers only.
- Use private object storage keys for documents, not public URLs.
- Generate short-lived signed URLs only for authorized admin review.
- Audit every admin KYC status change and document access.
- Define retention for rejected KYC documents and expired signed URLs before launch.

## Transfer Gating

Before any debit or transfer:

1. Require authenticated user.
2. Require transaction PIN.
3. Require `kycStatus === VERIFIED`.
4. Require non-suspended sender and eligible recipient.
5. Enforce amount, daily, and monthly limits by KYC tier.
6. Use idempotency keys for every mutation.
7. Execute wallet balance changes inside Prisma transactions.
8. Record ledger entries and audit/risk metadata.

## Production Checklist

- [ ] Apply the KYC Prisma migration in staging first, then production: from `backend/`, run `npx prisma migrate deploy` against the target `DATABASE_URL`.
- [ ] Generate the Prisma client after dependency install or migration deploy: from `backend/`, run `npx prisma generate`.
- [ ] Confirm the deployed schema includes `011_kyc_tier_foundation` before enabling KYC tier gates or provider-backed review.
- [ ] `PII_ENCRYPTION_KEY` configured and backed by a secret manager.
- [ ] `PII_KEY_VERSION` set for the active KYC identifier encryption key.
- [ ] `TRANSACTION_PIN_REQUIRED=true` in production.
- [ ] NIBSS/NIMC provider onboarding completed.
- [ ] BVN/NIN verification provider sandbox tests passing.
- [ ] KYC provider payloads redacted before logging.
- [x] Private document storage and signed admin access implemented.
- [x] KYC tier column and verification-result model implemented.
- [x] Manual-review provider gateway implemented as the safe default.
- [x] Tier 2 gate enforced for transfers, withdrawals, deposits, virtual accounts, beneficiaries, and VTU purchases.
- [ ] Supabase `kyc-documents` private bucket created with MIME and size restrictions.
- [ ] KYC admin access limited to `ADMIN` users and logged.
- [ ] Transfer, withdrawal, VTU, and virtual account limits approved by compliance.
- [ ] AML monitoring rules and suspicious-activity escalation path documented.
- [ ] Monnify live-mode BVN/NIN virtual-account flow tested with real provider credentials.
- [x] Monnify virtual-account provisioning uses the already verified stored BVN/NIN from KYC when available; it must not request repeated user entry for the same identifier.
- [ ] Monnify virtual-account webhook delivery tested from the provider dashboard.
- [ ] Paystack/Flutterwave checkout and VTU webhook delivery tested where those products are enabled.

## Staging And Production Setup Checklist

Use the same sequence for staging and production. Keep feature flags off until the checklist passes in the target environment.

1. Set backend environment variables with real values in the environment or secret manager. Do not put secrets in docs, screenshots, tickets, or committed `.env` files.
2. From `backend/`, run `npx prisma migrate deploy` against the target `DATABASE_URL`.
3. From `backend/`, run `npx prisma generate` so the deployed app uses a client generated for the current schema.
4. Create the Supabase Storage bucket named by `KYC_DOCUMENT_BUCKET` as a private bucket.
5. Restrict Supabase bucket MIME types to `image/jpeg`, `image/png`, `image/webp`, and `application/pdf`, and set the file-size limit to 8 MB or lower.
6. Verify user upload uses signed upload tokens and admin review uses short-lived signed read URLs.
7. Keep `ManualKycProvider` active until a licensed provider integration has sandbox evidence, production credentials, redaction tests, timeout handling, and manual-review fallback.
8. Before enabling Monnify virtual accounts, confirm in sandbox that the backend passes verified stored BVN/NIN from the KYC record to the provider; do not add a second virtual-account form that asks for BVN/NIN again.

Required backend env vars for KYC and document storage:

```env
DATABASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
KYC_DOCUMENT_BUCKET=kyc-documents
KYC_ADMIN_DOCUMENT_URL_TTL_SECONDS=300
PII_ENCRYPTION_KEY=
PII_KEY_VERSION=1
TRANSACTION_PIN_REQUIRED=true
```

Required backend env vars when Monnify virtual accounts are enabled:

```env
BANKING_ENABLED=true
VIRTUAL_ACCOUNTS_ENABLED=true
BANKING_PROVIDER_PRIMARY=monnify
BANKING_PROVIDER_FALLBACK=
SUPPORTED_BANKING_CURRENCIES=NGN
BANKING_SANDBOX_MODE=false
MONNIFY_API_KEY=
MONNIFY_SECRET_KEY=
MONNIFY_CONTRACT_CODE=
MONNIFY_BASE_URL=
MONNIFY_WEBHOOK_URL=
MONNIFY_WEBHOOK_SECRET=
MONNIFY_GET_ALL_AVAILABLE_BANKS=true
MONNIFY_RESTRICT_PAYMENT_SOURCE=false
BANK_ACCOUNT_ENCRYPTION_KEY=
```

Staging should use sandbox provider credentials, a staging Supabase project or isolated bucket, and `BANKING_SANDBOX_MODE=true`. Production should use live provider credentials, production-only encryption keys, HTTPS URLs, and feature flags enabled only after webhook and reconciliation smoke tests pass.

## References

- Supabase signed uploads: https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl
- Supabase upload to signed URL: https://supabase.com/docs/reference/javascript/storage-from-uploadtosignedurl
- Supabase private signed read URLs: https://supabase.com/docs/guides/storage/serving/downloads
- Monnify BVN/NIN virtual-account guidance: https://developers.monnify.com/docs/integration-guide-bvn-nin-update
- Monnify webhooks: https://developers.monnify.com/docs/webhooks
- Paystack webhooks: https://paystack.com/docs/payments/webhooks/
- Flutterwave webhooks: https://developer.flutterwave.com/docs/webhooks
