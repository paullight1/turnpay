# Ninja KYC Provider Design

## Goal

Replace Youverify as TRUSTPAY's active launch provider with Ninja's direct identity-verification API, while preserving the existing concurrency, consent, audit, privacy, and tier-promotion protections. Launch scope is Nigeria-only NIN and BVN verification with no monthly subscription.

## Chosen provider flow

- Use Ninja `POST /api/identity/identify` in `verify` mode.
- Do not use `lookup` mode because it returns the full registry record, including identity attributes TRUSTPAY does not need to retain.
- Do not use hosted KYC for the initial launch because it costs more and adds redirect, flow, selfie, liveness, and webhook complexity that is not required for the basic NIN/BVN tier checks.
- Send the selected `idType`, ID number, first name, last name, exact date of birth, and a stable TRUSTPAY verification reference.
- Treat a result as verified only when `found` is explicitly `true`, `verified` is explicitly `true`, and `recommendation` is `accept`.
- Map `review` to `REVIEW_REQUIRED`, `reject` or `found: false` to `REJECTED`, and malformed or unavailable upstream responses to a safe provider failure.

## User experience and API contract

- Expose the provider-neutral authenticated mutation `POST /api/kyc/verify` and retain the old Youverify route temporarily as a deprecated compatibility alias during client rollout.
- Require an `Idempotency-Key` header through the existing mutation interceptor.
- Accept only `country: NG`, `type: NIN | BVN`, an 11-digit identity number, exact ISO date of birth, and explicit consent.
- Keep the identity-type selector in TRUSTPAY's web and mobile interfaces.
- Add an exact date-of-birth field to the verification form. Use the account name for first/last-name verification and tell users to correct their profile before retrying when their legal name is incomplete.
- Replace provider-specific Youverify wording with clear Ninja consent copy and provider-neutral result messaging.
- Do not expose provider secrets, raw upstream responses, full identifiers, dates of birth, or registry values to the clients.

## Provider authentication and configuration

The backend configuration is:

```env
KYC_PROVIDER=ninja
NINJA_CLIENT_KEY=<exact value from the Ninja dashboard>
NINJA_CLIENT_SECRET=<exact value from the Ninja dashboard>
NINJA_BASE_URL=https://api.sandbox.ninja.boucloud.io
```

Production changes only the base URL to `https://api.ninja.boucloud.io` and uses separate production credentials. No static session token is configured. The provider exchanges the client key and secret through `POST /auth/session`, caches the returned token in process memory until shortly before its five-minute expiry, coalesces concurrent token requests, and retries an identity call once with a fresh token after an upstream `401`.

The production configuration validator must require Ninja credentials, reject the sandbox URL in production, and stop requiring Youverify webhook settings when Ninja is selected. Health output reports only readiness booleans and never configuration values.

## Persistence, privacy, and audit

- Add `NINJA` to `KycVerificationProvider` through a Prisma migration.
- Keep the existing transactional attempt reservation, active-attempt uniqueness constraint, encrypted identity-number storage, atomic result persistence, tier calculation, and audit logging.
- Make the KYC service provider-neutral so the selected gateway's provider value drives persistence and audit metadata.
- Record a new provider-neutral consent version that names Ninja as the recipient in the displayed consent text.
- Store only allowlisted evidence: provider status, found/verified flags, recommendation, total score, per-field name/match/score, document type, country, and masked identifier.
- Drop Ninja response fields such as `provided`, free-text details, registry data, photos, phone numbers, addresses, and dates of birth before hashing, persistence, logging, or returning data.
- Use the internal document UUID as Ninja's request `reference`, ensuring provider retries use the same reference and remain bill-safe under Ninja's documented 24-hour retry behavior.

## Failure handling

- Apply the existing circuit breaker under a Ninja-specific circuit name.
- Use HTTPS-only allowlisted Ninja hosts and disable redirects through the existing HTTP client settings.
- Convert upstream authentication, timeout, rate-limit, payment/balance, and 5xx responses into safe client errors without leaking provider bodies.
- A failed provider call releases the reserved attempt transactionally so the customer can retry.
- Direct verification is synchronous, so Ninja webhook infrastructure is not added. Existing Youverify webhook code remains dormant for rollback compatibility and can be removed after the migration window.

## Testing and verification

- Add provider tests before implementation for request shape, token caching, concurrent token acquisition, expiry refresh, one-time `401` retry, strict success mapping, review/reject mapping, malformed responses, supported types, identifier redaction, and safe errors.
- Update KYC service and controller tests for provider-neutral naming, Ninja persistence, consent evidence, idempotency coverage, and Nigeria-only validation.
- Update production-config and health-readiness tests for Ninja sandbox and live environments.
- Update website and Flutter tests before changing their forms and API paths.
- Run Prisma validation/generation, focused backend tests, backend lint/build, focused web tests/lint/build, and focused Flutter tests/analyze.
- Use Ninja's documented sandbox IDs only after the user installs credentials locally; never place credentials in test fixtures or committed files.

## User-only launch steps

1. Create or sign into the Ninja account and copy the Client Key and Client Secret into the backend secret store.
2. Keep the sandbox base URL while TRUSTPAY runs the documented found, not-found, and simulated-upstream-failure cases.
3. Complete Ninja's production account/KYB requirements and confirm the commercial and data-processing terms.
4. Fund the Ninja wallet with a small controlled amount.
5. Install separate production credentials, change only `NINJA_BASE_URL` to the live host, deploy, and run one controlled live verification.
