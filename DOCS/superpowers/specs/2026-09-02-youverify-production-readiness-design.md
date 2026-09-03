# Youverify Production Readiness Design

## Goal

Make TRUSTPAY's Youverify-only KYC journey correct, concurrency-safe, auditable, operationally observable, and usable from web, mobile, and admin surfaces.

## Provider contract and decision policy

- Send name matching in Youverify's `validations.data` object.
- Treat `found` as verified only when `allValidationPassed` is explicitly `true`.
- Treat mismatched or incomplete validation as `REVIEW_REQUIRED`; never promote a KYC tier from `dataValidation` alone.
- Hash only stable normalized provider facts. Receipt timestamps are persisted separately and never influence replay identity.
- Mask identifiers in all API responses and logs; store full identifiers only with the existing AES-GCM encryption helper.

## Submission consistency

- Persist a `PROCESSING` KYC document and consent evidence before calling Youverify.
- Enforce one active attempt for each user and identity type with a partial Postgres unique index.
- Call the provider outside the database transaction, then atomically persist the result, verification evidence, tier transition, and audit record.
- A failed provider call moves the reserved attempt to `REJECTED` with a safe retry message so users are not permanently blocked.

## Webhook processing

- Verify the HMAC signature against the raw request body before accepting the event.
- Store a sanitized event in a dedicated KYC webhook inbox, keyed by provider reference, event type, and stable payload hash.
- Return immediately after durable acceptance. A scheduled processor claims events, applies valid status transitions, retries with exponential backoff, and dead-letters after five attempts.
- `FAILED` provider callbacks are recoverable; only `VERIFIED` and `REJECTED` are terminal business decisions.

## Consent and review evidence

- Store `consentRecordedAt`, `consentVersion`, and `consentSource` on every provider verification.
- Expose only a whitelisted review summary: provider status, validation booleans, country, provider type, masked identifier, and timestamps.
- Provider-hosted rows open directly in the admin review panel; document URLs remain available only for legacy uploaded documents.
- Admin decisions require a reason and continue to emit audit logs.

## User experience

- Replace the website's legacy Supabase upload page with the same direct Youverify contract used by mobile.
- Use a compact financial-utility layout: current tier/status, exact next requirement, one form, explicit consent, one primary action, and concise history.
- Tier 1 is not completion for Nigeria. A verified BVN prompts for NIN and a verified NIN prompts for BVN until Tier 2 is reached.
- Do not promise transfers or withdrawals before Tier 2.
- Remove the support widget from authenticated dashboard/admin routes to avoid CSP violations and prevent third-party scripts from observing sensitive screens.

## Operational readiness

- Validate the Youverify API key, base URL, webhook secret, public HTTPS webhook URL, and PII encryption key in staging and production.
- Surface a safe KYC readiness component in health output without exposing configured values.
- Keep a live sandbox contract test opt-in through environment variables. It must fail clearly when credentials lack required Youverify permissions.

## External launch gates

Code cannot grant permissions to the Youverify account or configure its dashboard. Launch remains blocked until a correctly permissioned environment-specific API key is installed and the public webhook URL is registered in Youverify.
