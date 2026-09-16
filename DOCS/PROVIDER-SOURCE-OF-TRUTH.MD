# TRUSTPAY Provider Source of Truth

Last reviewed: 2026-09-03

These are the only active external providers:

| Capability | Provider | Backend callback |
| --- | --- | --- |
| KYC | Monnify verification API | None; direct verification returns synchronously |
| Banking, deposits, bank resolution, virtual accounts, withdrawals | Monnify | `/api/webhooks/monnify` |
| Nigeria airtime, data, cable, electricity | VTpass | Trusted gateway → `/api/webhooks/vtu/vtpass` |

No client application may contain a provider API key or webhook secret. Provider mutations must enter through authenticated TRUSTPAY backend endpoints with idempotency, and webhook state changes must verify signatures and execute transactionally.

Every non-Nigerian VTU market is `Coming soon` and disabled. The VTpass callback
must pass through TRUSTPAY's controlled ingress, which validates the upstream
request and signs the unchanged raw body with `VTPASS_WEBHOOK_SECRET`; direct
unsigned delivery to the backend is rejected.

Legacy database enum values and already-applied migrations remain so existing records can still be read. Ninja and Youverify provider adapters remain in the repository only for historical records/rollback compatibility; Monnify is the active KYC provider.

Required provider selector values:

```env
KYC_PROVIDER=monnify
BANKING_PROVIDER_PRIMARY=monnify
BANKING_PROVIDER_FALLBACK=
VTU_PROVIDER=vtpass
```
