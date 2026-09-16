# Your Monnify setup steps

## Code prepared

- Provisioning uses stored verified identities and rejects different client-supplied BVN/NIN.
- Customer onboarding is intentionally fixed to NIN first and BVN second. A verified NIN provisions a limited Tier 1 account; verified BVN upgrades the account to the Tier 2 limit profile.
- Configure `MONNIFY_TIER_1_LIMIT_PROFILE_CODE` and `MONNIFY_TIER_2_LIMIT_PROFILE_CODE` from the profiles created in the Monnify dashboard. Production provisioning fails closed when the applicable code is missing.
- Existing-account access now checks completed KYC before returning the account.
- Existing Monnify accounts have a scheduled KYC sync worker, durable success/retry markers in virtual-account metadata, multi-worker claim protection and audit events. No schema migration is needed.
- Sync is disabled by default. Set MONNIFY_KYC_SYNC_ENABLED=true only in the intended backend environment after credentials and accounts have been checked. Every minute it examines a batch of 25 eligible accounts and cycles through the remainder. Failed updates retry with backoff; successful unchanged identity versions are skipped.
- The Flutter pending/review/decision flow is implemented. Email and push delivery are still pending; there is no application email transport or device push delivery setup in the inspected backend.

## What you need to do

1. Finish Monnify business activation. Confirm reserved accounts and API disbursements are enabled for TrustPay's approved business model, plus the permitted transaction limits and settlement account.
2. Switch the dashboard to Live. Under Developer → API Keys & Contracts, obtain the live key, secret and contract code. Put them directly into your backend host's environment settings; do not paste secrets into chat.
3. Set MONNIFY_BASE_URL=https://api.monnify.com, the live MONNIFY_API_KEY, MONNIFY_SECRET_KEY and MONNIFY_CONTRACT_CODE. Set BANKING_SANDBOX_MODE=false and MONNIFY_SANDBOX_TEST_KYC_BYPASS=false. Use separate live and sandbox customer/account records.
4. Configure the HTTPS backend webhook URL under Developer → Webhook URLs. The implemented route is /api/webhooks/monnify on your deployed API domain. Configure the relevant collection and disbursement events. Set MONNIFY_WEBHOOK_URL to that deployed URL. Verify delivery and signature handling before accepting deposits.
5. Obtain a static outbound IP from your backend host. Ask Monnify integration support to whitelist it for API disbursements and confirm the authorization/OTP arrangement for your merchant. Do not turn off authorization based solely on a generic checklist.
6. Confirm/fund the Monnify disbursement wallet and verify settlement configuration. Never put real funds into a sandbox test.
7. Fund and enable Monnify’s live verification services. Set KYC_PROVIDER=monnify and use the live Monnify API key, secret, and base URL. Monnify’s NIN/BVN verification responses are now the authoritative KYC result.
8. Choose the transactional email service and verify a sender domain/address. Provide the service name and sender address, not its secret. Email approval notices can then be wired into that service. Push requires its own app/device-token setup.
9. After the environment is reviewed, enable MONNIFY_KYC_SYNC_ENABLED=true. Check MONNIFY_KYC_SYNCED / MONNIFY_KYC_SYNC_FAILED audit events; never treat a failed external sync as success.
10. Complete a controlled live acceptance test with your own consenting test customer: identity approval → virtual account → small deposit → exact wallet credit → small authorized withdrawal → settlement/reconciliation. You must authorize and perform real financial actions. Include duplicate webhooks and failed/reversed payment cases in the non-production tests.

## Boundaries still requiring validation

- Mock tests prove code behavior, not live credentials, product entitlement or provider uptime.
- KYC linking is documented as a live feature; do not use sandbox success as proof of live KYC linking.
- The worker uses the accountReference format created by this code: TP-NGN-{userId}, truncated to 64 characters. Imported/legacy accounts with a different reference need an explicit mapping before enabling their sync.
- Notifications have not been sent and provider settings have not been changed by this task.

Official references:
- https://developers.monnify.com/docs/live
- https://developers.monnify.com/docs/integration-guide-bvn-nin-update
- https://teamapt.atlassian.net/wiki/spaces/MON/pages/1057128525/Update+Reserved+Account+KYC+Info
- https://developers.monnify.com/docs/webhooks
