# External Provider Checklist

Use this before enabling real traffic. Provider selection is fixed by
`DOCS/PROVIDER-SOURCE-OF-TRUTH.MD`.

## Monnify

- Live API key, secret key, and contract code stored in backend secrets.
- Reserved accounts, collections, account resolution, and disbursements approved.
- `/api/webhooks/monnify` registered and raw-body signature verification proven.
- Duplicate callbacks and reconciliation tested.
- Settlement account, balance, transfer limits, fees, and support contacts confirmed.

## VTpass

- Live API, public, and secret keys stored in backend secrets.
- Nigerian airtime networks, data plans, cable services, and electricity billers
  confirmed against the live catalogue.
- Customer/meter validation, transaction requery, timeout, failure, and reversal
  behavior tested.
- `/api/webhooks/vtu/vtpass` callback authentication and replay handling proven.

## Monnify KYC

- Monnify identity-verification access and commercial terms approved for the
  intended BVN/NIN checks.
- Shared Monnify API credentials and the PII encryption key are installed only
  in the backend secret manager.
- Consent, exact identity match behavior, failure handling, duplicate attempts,
  tier promotion, and audit evidence are validated in sandbox.
- Production activation is recorded with a controlled low-risk verification
  and privacy/compliance approval. KYC does not use a separate webhook.

## Operations and security

- Admin user and dual-approval policies are defined.
- Daily reconciliation and incident runbooks have named owners.
- Secrets exist only in environment variables or a secret manager.
- Every mutation supports idempotency and every webhook has replay protection.
- Account numbers and identity values are encrypted at rest and masked in UI/logs.
- Provider dashboard access and escalation contacts are controlled and audited.
