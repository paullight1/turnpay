# External Provider Checklist

Use this before enabling real money traffic.

## Paystack

- Production secret key and public key.
- Dedicated webhook URL for backend `/api/webhooks/paystack`.
- Webhook signature verification tested with raw body.
- Dedicated virtual account product approved.
- Transfer recipient creation enabled.
- Bank list and account resolve enabled.
- Transfer status verification endpoint tested.
- Settlement account configured.

## Flutterwave

- Production secret key and encryption key.
- Confirm webhook verification mode:
  - `flw-signature` HMAC, or
  - `verif-hash` static verification hash.
- Webhook URL registered for backend `/api/webhooks/flutterwave`.
- Ghana payout/mobile-money capability confirmed.
- Currency support confirmed for NGN and GHS.
- Bank/mobile-money destination requirements documented.

## VTU/Data/Electricity Provider

- Airtime networks and codes.
- Data bundle catalog endpoint.
- Data plan package IDs.
- Electricity biller list.
- Meter validation endpoint.
- Receipt/reference format.
- Failure/reversal behavior.

## Operations

- Admin user policy.
- Dual approval threshold.
- Reconciliation schedule.
- Incident runbook.
- Provider dashboard access.
- Support escalation contacts.
- Daily settlement report process.

## Security

- Secrets stored only in environment variables or a secrets manager.
- No provider secret printed in logs.
- Idempotency key required for every mutation.
- Webhook replay protection active.
- Account numbers masked in admin UI and logs.
