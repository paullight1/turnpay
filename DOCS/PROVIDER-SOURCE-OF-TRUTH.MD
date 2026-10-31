# TRUSTPAY Provider Source of Truth

Last reviewed: 2026-10-31

These are the only active external providers:

| Capability | Provider | Backend callback |
| --- | --- | --- |
| Automated BVN + bank validation and NGN account preparation | Paystack customer validation and dedicated accounts | `/api/webhooks/paystack`; asynchronous verification and account preparation |
| NIN/document upgrades | Authorized manual evidence review | Authenticated admin KYC review |
| New NGN funding, bank resolution, dedicated accounts and withdrawals | Paystack | `/api/webhooks/paystack` |
| New GHS accounts, MoMo collections and MoMo payouts (disabled until activation) | Kora | `/api/webhooks/kora` |
| Existing Monnify accounts and unfinished obligations | Legacy Monnify reconciliation | `/api/webhooks/monnify` |
| Nigeria airtime, data, cable, electricity | VTpass | Trusted gateway → `/api/webhooks/vtu/vtpass` |

No client application may contain a provider API key or webhook secret. Provider mutations must enter through authenticated TRUSTPAY backend endpoints with idempotency, and webhook state changes must verify signatures and execute transactionally.

Every non-Nigerian VTU market is `Coming soon` and disabled. The VTpass callback
must pass through TRUSTPAY's controlled ingress, which validates the upstream
request and signs the unchanged raw body with `VTPASS_WEBHOOK_SECRET`; direct
unsigned delivery to the backend is rejected.

Legacy database enum values and already-applied migrations remain so existing records can still be read. Existing Monnify obligations keep their provider identity; new NGN activity uses Paystack. A verified BVN grants Tier 1 under the existing tier policy; Tier 2 still requires additional independently verified evidence. Paystack validation must not silently promote withdrawal eligibility.

See [Paystack activation](PAYSTACK-ACTIVATION.md) for migration, merchant product access, webhook setup, transfer approvals and acceptance checks. A configured secret alone is not proof of live readiness.

Required provider selector values:

```env
KYC_PROVIDER=paystack
BANKING_PROVIDER_PRIMARY=paystack
BANKING_PROVIDER_FALLBACK=
VTU_PROVIDER=vtpass
```

## Ghana integration — 31 October 2026

Kora is the explicit GHS provider for new Ghana receiving accounts, MoMo collections and MoMo payouts. It is disabled by default and does not replace `BANKING_PROVIDER_PRIMARY=paystack` for NGN. Existing Monnify obligations retain their stored provider. Ghana bank payouts remain unsupported. Provider-backed exchange orders use a separate aggregate from historical manual orders; verified wallet deposits cannot also fund direct external orders.

Both provider business approvals, enabled products, configured GHS limits, prefunded provider balances and signed sandbox receipt/payout acceptance are required before live use. Possession of a merchant MoMo wallet or a Kora secret is not approval. See [Kora setup](KORA-GHANA-SETUP.md).
