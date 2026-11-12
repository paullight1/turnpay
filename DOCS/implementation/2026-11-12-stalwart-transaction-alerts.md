# Stalwart account and transaction alerts

Scope confirmed: automatic account and transaction alerts. Campaigns and newsletters are outside this rollout.

## Current deployment state

- Dokploy project: `trustpay`, production environment.
- Stalwart compose service: `trustpay-stalwart-uilnol`.
- Saved image: `stalwartlabs/stalwart:v1.1.0-alpine@sha256:8988c12e4070b2d3b96b41478191df21d1a8a06702a249155815b1e497961526`.
- Persistent configuration/data volumes retained; image pinned and container logs bounded.
- Stalwart has not been deployed or initialized. Its generated HTTP hostname is unsuitable for entering administrator credentials.
- Backend email provider remains disabled. No customer email or historical notification backlog was sent during setup.

## Activation dependencies

1. Sign in to the domain's Spaceship account. Authoritative nameservers are `launch1.spaceship.net` and `launch2.spaceship.net`.
2. Configure `mail.trustpayhq.com` against the existing mail server IP after confirming the deployment address. At inspection, this hostname did not exist, the root domain had no MX or SPF record, and DMARC was `v=DMARC1; p=none;`.
3. Publish only the required SMTP services. Protect administration with HTTPS before initialization; retain existing volumes. Keep IMAP/POP3 and other unused services private. Never enter credentials over the generated HTTP endpoint.
4. Configure a certificate covering the SMTP hostname. With a TLS-terminating reverse proxy, use an ACME challenge route supported by that topology; HTTP-01 requires forwarding the challenge path on port 80. An HTTPS certificate on the web proxy alone does not establish TLS on SMTP.
5. Generate DKIM in Stalwart and publish its exact selector/key records. Publish SPF and appropriate bounce/MX handling, preserving unrelated DNS records. Request a matching reverse-DNS hostname from the server provider; the existing PTR is the provider's generic server name.
6. Create a dedicated submission identity restricted to the intended TrustPay sender. The account owner must enter any new administrator/submission credentials privately. Keep unauthenticated relay disabled.
7. Verify strict TLS and SMTP authentication from the backend runtime, then send only to an explicitly approved test recipient. Inspect actual recipient headers for SPF, DKIM and DMARC results; confirm acceptance, receipt and bounce behavior separately.
8. Set `EMAIL_OUTBOX_NOT_BEFORE` to the approved activation timestamp so initial activation does not release the historical backlog. Keep `EMAIL_PROVIDER=disabled` until all checks pass. Configure SMTP secrets only in protected deployment settings.
9. Activate a small approved pilot, verify the outbox/queue and customer-facing messages, then expand. An SMTP acceptance is not proof of inbox delivery. Ambiguous sends must remain unknown rather than being retried blindly.

The backend stores notification intents in the same database transaction as their originating wallet movement. Financial messages must use immutable ledger amounts and balance-after values, verify the recipient's ownership, and distinguish wallet reservation from completed external payment. Notification event keys must remain stable on idempotent retries.

Before transport, the worker verifies the recipient against Supabase Auth Admin: the identity ID must match, the address must be confirmed, and the provider address must match the current local address. Missing configuration, mismatches and lookup failures retry without sending; a 10-second deadline prevents a hung verification from blocking dispatch indefinitely. OTP delivery uses its existing separate path.

Initial coverage includes shared-ledger credits/debits and refunds, enriched deposit confirmations, and terminal status alerts for withdrawals, VTU and manual exchange. Automated provider-exchange flows retain ledger movement/refund alerts; a separate terminal-status email for those flows is outside this initial pilot.

Verification completed on 12 November 2026: 964 backend unit tests, the backend build and lint checks, and 127 financial integration tests against isolated local PostgreSQL/Redis. The disposable database and Redis instance were removed/stopped afterward. No real financial transaction, provider activation or customer email was used for verification.

## References

- [Stalwart SMTP submission and relay](https://stalw.art/docs/mta/)
- [Stalwart ACME challenge types](https://stalw.art/docs/server/tls/acme/challenges/)
- [Stalwart domain DNS records](https://stalw.art/docs/domains/)
- [Stalwart Docker deployment](https://stalw.art/docs/install/platform/docker/)
