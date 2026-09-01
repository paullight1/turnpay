# 03 — Payment and Banking Provider Certification

## Goal

Prove that all external payment, banking, VTU, FX, and KYC providers are correctly configured and can be operated safely.

## Owner

Provider-integration owner and operations lead.

## Steps

- [ ] Complete KYB, business verification, settlement-account setup, and production approval for every provider.
- [ ] Store live credentials only in the approved secret manager. Never place them in Git, `.env` files, logs, tickets, or screenshots.
- [ ] Configure canonical HTTPS webhook URLs, signature secrets, allowlists, timeout policy, retry policy, and provider dashboard alerts.
- [ ] Run each provider in sandbox first: successful payment, failed payment, duplicate event, out-of-order event, refund/reversal, timeout, and invalid signature.
- [ ] Confirm the webhook inbox accepts quickly, processes asynchronously, retries failures, recovers stale claims, and dead-letters exhausted events.
- [ ] Compare provider amount, currency, reference, and settlement data with the internal transaction before crediting or debiting money.
- [ ] Switch one provider at a time to live mode with a small controlled transaction and verify settlement.
- [ ] Record dashboard screenshots, test references, callback logs, settlement proof, and rollback instructions.

## Evidence required

Provider approval emails, KYB records, secret-manager references, webhook test IDs, signature-verification results, settlement statements, and certification sign-off.

## Exit criteria

Every enabled provider has passed sandbox and controlled-live certification, with an owner, fallback path, alerting, and a documented disable switch.
