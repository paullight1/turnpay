> Provider update, 2026-10-30: new payment and automated BVN flows use Paystack. The Monnify implementation details below apply to legacy obligations. Follow [Paystack activation](PAYSTACK-ACTIVATION.md) and the provider source of truth for current setup.

# TRUSTPAY Monnify KYC Guide

Last reviewed: 2026-09-27

Monnify is TRUSTPAY's only KYC provider for Nigerian BVN and NIN checks. Web
and Flutter call TRUSTPAY's authenticated backend. Monnify credentials must
never be placed in a browser, mobile build, `NEXT_PUBLIC_*` variable, log,
screenshot, ticket, or source-controlled environment file.

## Verification and account preparation flow

1. The authenticated client first sends `country: NG`, `type: NIN`, an
   11-digit identifier, ISO date of birth, explicit consent, and an
   `Idempotency-Key` to `POST /api/kyc/verify`. The consent notice explains
   that identity details are sent to Monnify for verification and automatic
   NGN account setup. After NIN succeeds, the client can submit the second
   check with `type: BVN`.
2. The backend validates the DTO, reserves a single active attempt, reads the
   user's legal names and phone, and uses the KYC document row ID as the local
   verification reference.
3. The backend obtains a short-lived Monnify access token server-side.
4. The backend calls Monnify's NIN or BVN verification endpoint and maps the
   response match flag into TRUSTPAY's verified or rejected status.
5. A result is accepted only when Monnify reports a successful request and the
   relevant identity match flag is true. Invalid or unavailable responses fail
   closed.
6. The identifier is encrypted at rest. Only an allowlisted, sanitized evidence
   summary is stored or returned, and the public identifier remains masked.
7. Document status, verification status, user status, tier, and audit data are
   committed transactionally.
8. After a successful check, the backend automatically provisions or reuses
   the user's Monnify NGN virtual account. The response reports `READY` with
   masked account details, or `PENDING` if account setup needs a retry. Existing
   authenticated account screens can then load the prepared account without
   requiring another identity-verification action.

Identity verification and account preparation are triggered by one KYC form
submission. Both provider operations currently run synchronously in the backend
request, so account preparation can delay the response. Monnify identity
verification does not use a KYC webhook. Funding webhooks remain separate and
are used only for payment events.

## Supported checks

| Country | TRUSTPAY type | Monnify endpoint | Required input |
| --- | --- | --- | --- |
| Nigeria | `NIN` first | `/api/v1/vas/nin-verification` | 11-digit NIN |
| Nigeria | `BVN` second | `/api/v1/vas/bvn-details-match` | 11-digit BVN, legal name, date of birth, phone |

The clients do not offer Ghana, passport, driver's licence, or voter's card in
this release. Unsupported combinations are rejected before a provider call.

## Backend environment

Sandbox or production:

```env
KYC_PROVIDER=monnify
MONNIFY_API_KEY=<server-side Monnify API key>
MONNIFY_SECRET_KEY=<server-side Monnify secret key>
MONNIFY_BASE_URL=https://sandbox.monnify.com
PII_ENCRYPTION_KEY=<at least 32 characters from the secret manager>
PII_KEY_VERSION=1
```

Production uses separate live credentials and URL:

```env
KYC_PROVIDER=monnify
MONNIFY_API_KEY=<exact live dashboard value>
MONNIFY_SECRET_KEY=<exact live dashboard value>
MONNIFY_BASE_URL=https://api.monnify.com
```

TRUSTPAY obtains and caches the Monnify access token internally. Never place
Monnify credentials in Flutter, website code, logs, or source control.

Official references:

- Verification API: https://developers.monnify.com/docs/verification-api/verifying-your-customers
- BVN/NIN account guide: https://developers.monnify.com/docs/integration-guide-bvn-nin-update

## Sandbox validation

Use only Monnify-provided sandbox identities and instructions supplied through
the authorized Monnify dashboard or integration documentation. Do not copy
identity test values from historical Ninja or Youverify notes into this guide.
Never submit test identities to the production endpoint.

## Status and tier mapping

| Monnify result | TRUSTPAY verification | User effect |
| --- | --- | --- |
| Monnify request succeeds and the relevant identity-match flag is true | `VERIFIED` | First BVN/NIN reaches at least Tier 1; both reach Tier 2 |
| Monnify reports a non-matching identity | `REJECTED` | `REJECTED`; no automatic tier promotion |
| Monnify rejects or cannot match the identity | `REJECTED` | `REJECTED` unless the user already has a stronger terminal state |
| Invalid response or transport failure | `FAILED` | No promotion; safe retry is allowed |

HTTP success alone never means identity success.

## Security and privacy controls

- `JwtAuthGuard`, rate limiting, DTO validation, explicit consent, and
  `Idempotency-Key` are mandatory on `POST /api/kyc/verify`.
- The client-supplied name is not trusted. Legal names come from the authenticated
  TRUSTPAY profile.
- Identifier and date of birth must not appear in application logs, audit
  metadata, error messages, Sentry, analytics, or provider evidence.
- Raw provider responses, images, phone numbers, addresses, and supplied values
  must not be stored or returned.
- Production accepts only `KYC_PROVIDER=monnify`, HTTPS Monnify endpoints, shared
  Monnify API credentials, and a PII encryption key.
- All status, tier, and audit changes remain in one Prisma transaction.
- Consent version and time are recorded with each attempt.

## Sandbox certification

- [ ] Confirm Monnify sandbox identity-verification access is enabled for the
      account and obtain the current test identities from the authorized
      Monnify dashboard/documentation.
- [ ] Configure sandbox Monnify API credentials and the sandbox base URL only
      in the backend staging secret manager.
- [ ] Confirm `/api/health/live` is `ok` and `/api/health/ready` reports KYC
      `configured` without returning config values.
- [ ] Verify successful match, mismatch/rejection, provider error, timeout, and
      malformed response behavior using Monnify's authorized sandbox data.
- [ ] Retry an identical client request and confirm the idempotency response is
      replayed without a second active attempt.
- [ ] Race two requests for the same user/type and confirm only one reservation
      reaches Monnify.
- [ ] Search logs, traces, Sentry, admin responses, and analytics for raw BVN,
      NIN, date of birth, names, and provider payloads; all must be absent.
- [ ] Confirm the web and mobile screens cover empty, loading, network error,
      review, rejected, provider failure, Tier 1 next step, and Tier 2 complete.

## Production gates

- [ ] Monnify has approved the business for the identity-verification product
      and issued production credentials.
- [ ] Compliance/privacy owners approve consent language, lawful basis,
      retention/deletion, tier rules, and Nigerian BVN/NIN use.
- [ ] Live shared Monnify credentials exist only in the production backend secret
      manager.
- [ ] `KYC_PROVIDER=monnify`; live endpoint and no sandbox/test identity are
      present in production.
- [ ] `./scripts/validate-production-config.sh true` succeeds in the target
      environment.
- [ ] A controlled live happy path and mismatch path succeed with masked
      evidence and no PII leakage.
- [ ] Provider error rate, latency, circuit-breaker state, and repeated
      authentication failures have alerts and a named owner.
- [ ] A named accountable owner records the final GO decision.

Passing automated tests is necessary but is not regulatory certification.
Transfers, withdrawals, VTU, and virtual-account provisioning must stay behind
the approved KYC/tier gates until production certification is complete.
