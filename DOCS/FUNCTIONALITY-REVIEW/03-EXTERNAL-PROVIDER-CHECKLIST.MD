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

## Youverify

- Live API token stored only in backend secrets.
- Direct identity products and commercial access approved for intended countries.
- `/api/webhooks/kyc/youverify` registered with the HTTPS signing key matching
  `YOUVERIFY_WEBHOOK_SECRET`.
- Success, pending, review, failure, duplicate, invalid-signature, and stale-event
  paths tested without logging raw identifiers.

## Operations and security

- Admin user and dual-approval policies are defined.
- Daily reconciliation and incident runbooks have named owners.
- Secrets exist only in environment variables or a secret manager.
- Every mutation supports idempotency and every webhook has replay protection.
- Account numbers and identity values are encrypted at rest and masked in UI/logs.
- Provider dashboard access and escalation contacts are controlled and audited.
