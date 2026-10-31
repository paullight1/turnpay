# KYC and Monnify readiness — 5 September 2026

Implementation follow-up: the identity override guard, existing-account KYC access guard, and scheduled reserved-account KYC sync are now implemented and tested. Sync remains disabled pending environment confirmation. The original findings below describe the pre-change gaps; use [MONNIFY-OWNER-SETUP.md](MONNIFY-OWNER-SETUP.md) for current enablement steps and remaining work.

## Confirmed from the local implementation

- Active configured identity provider: Monnify. The deployed identity flow is direct and synchronous; TRUSTPAY no longer ships an alternate KYC provider or KYC callback path.
- Monnify verifies BVN/NIN against legal first name, last name and date of birth. TRUSTPAY marks a check VERIFIED only when Monnify reports request success and the corresponding information-match flag; other completed checks are REJECTED. Transport failures fail closed and do not promote a KYC tier.
- Monnify uses a direct response in this implementation, not callbacks. Manual review requires an actual admin decision. Flutter polling reads our saved backend status; it does not initiate another paid identity check.
- The backend persists verification records and supports audited admin review. Local provider and service tests are not proof of live credentials, funded provider access, availability or successful real-person verification.
- Flutter now hides the form during SUBMITTED, PENDING_REVIEW and REVIEW_REQUIRED, checks status every 15 seconds while the screen remains mounted, preserves pending state on a background refresh failure, and offers Check status. Approved/rejected results come from the backend. This is not an email or push notification implementation.
- Monnify is configured for sandbox. New reserved-account provisioning accepts the first verified NIN for the limited Tier 1 profile, decrypts it server-side, and includes it in the Monnify request. The second, BVN verification upgrades the account to the Tier 2 profile.
- The fixed Nigerian flow is NIN first, then BVN. The backend rejects a BVN attempt before a verified NIN and rejects duplicate NIN submissions.
- Reserved-account KYC syncing is implemented for Tier 1 and Tier 2 accounts. It sends the currently verified identifier(s) to Monnify and retries safely until the provider confirms success.
- The provisioning input also accepts explicit BVN/NIN overrides. Before production, enforce that these are the same verified identities rather than trusting replacement identifiers supplied by a client.

## Monnify requirements and connection

For customer reserved accounts, Monnify documents linking BVN or NIN for limited accounts, and both for its maximum-limit option. TrustPay uses NIN for the initial limited account and BVN as the second upgrade check. The configured Monnify limit-profile codes, not the internal tier label alone, determine the provider limits.

New accounts: verify NIN first, then POST the Monnify reserved-account endpoint with a stable accountReference, accountName, customerName, customerEmail, currencyCode NGN, contractCode, the verified NIN and the configured Tier 1 limitProfileCode. Save the returned account only after a successful response. After BVN is verified, update the Monnify KYC info and reserved-account limit profile. Monnify performs its own checks; a KYC approval is not a substitute for the identifiers or a guarantee of Monnify approval.

Existing accounts: PUT `/api/v1/bank-transfer/reserved-accounts/{accountReference}/kyc-info` with the verified NIN or BVN, then apply the configured higher limit profile when both checks are complete. The implementation uses a durable, retryable sync marker keyed by account and identity version, records success/failure safely, and never labels the external sync complete before Monnify confirms it. Keep identifiers encrypted, out of logs, and out of Flutter responses.

Sources:
- https://developers.monnify.com/docs/integration-guide-bvn-nin-update
- https://teamapt.atlassian.net/wiki/spaces/MON/pages/1057128525/Update+Reserved+Account+KYC+Info

## Beyond business-account activation

1. Obtain live API credentials and the correct live contract code; configure the live base URL server-side. Confirm the Monnify identity-verification product is enabled for the live account and record its pricing and permissions.
2. Confirm Monnify enables the intended reserved-account and disbursement products for this business, and confirm customer limit profiles and settlement configuration.
3. Finish the verified-identity override guard and existing-account KYC sync above. Preserve separate internal KYC and external account provisioning/sync states.
4. Deploy reachable HTTPS collection/disbursement webhooks; verify signatures on the raw payload, reject invalid events, and prove duplicate delivery cannot double-credit a wallet. Confirm the current signature contract using Monnify's live integration examples because its documentation contains differing wording.
5. Arrange static outbound IP addresses and Monnify whitelisting for disbursements. Agree the supported OTP/authorization arrangement with Monnify; do not change security settings automatically.
6. Configure and fund the disbursement wallet, verify account-name resolution, and test pending, failed and reversed withdrawals as well as successful transfers.
7. Run controlled acceptance tests for account creation, KYC linking, a deposit, reconciliation, withdrawal and webhook retries. Confirm ledger totals and settlement amounts, and retain evidence before declaring production ready.

Sources:
- https://developers.monnify.com/docs/live
- https://developers.monnify.com/docs/webhooks
- https://developers.monnify.com/docs/disbursements/single-transfers
- https://developers.monnify.com/blog/building-a-wallet-service-with-monnify

Historical review updated 2026-09-27 to reflect the Monnify-only decision. No live provider configuration or customer identity was changed during this documentation update. No real identity check, payment, or external account creation was submitted.
