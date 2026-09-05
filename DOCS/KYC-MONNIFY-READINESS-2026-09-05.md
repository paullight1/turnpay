# KYC and Monnify readiness — 5 September 2026

Implementation follow-up: the identity override guard, existing-account KYC access guard, and scheduled reserved-account KYC sync are now implemented and tested. Sync remains disabled pending environment confirmation. The original findings below describe the pre-change gaps; use [MONNIFY-OWNER-SETUP.md](MONNIFY-OWNER-SETUP.md) for current enablement steps and remaining work.

## Confirmed from the local implementation

- Active configured identity provider: Ninja, using its sandbox host. Youverify is selectable as a rollback provider, not an automatic second check.
- Ninja verifies BVN/NIN against legal first name, last name and date of birth. Its adapter maps found + verified + recommendation accept to VERIFIED; not found or reject to REJECTED; other matches to REVIEW_REQUIRED. Transport failures are not approvals.
- Ninja uses a direct response in this implementation, not callbacks. Manual review requires an actual admin decision. Flutter polling reads our saved backend status; it does not initiate another paid identity check.
- The backend persists verification records and supports audited admin review. Local provider and service tests are not proof of live credentials, funded provider access, availability or successful real-person verification.
- Flutter now hides the form during SUBMITTED, PENDING_REVIEW and REVIEW_REQUIRED, checks status every 15 seconds while the screen remains mounted, preserves pending state on a background refresh failure, and offers Check status. Approved/rejected results come from the backend. This is not an email or push notification implementation.
- Monnify is configured for sandbox. New reserved-account provisioning already accepts stored verified BVN/NIN, decrypts them server-side, and includes them in the Monnify request. TrustPay requires verified Tier 2 before provisioning outside its sandbox bypass.
- There is no reserved-account KYC update endpoint implementation in the searched backend. Existing accounts need a separate sync path; simply marking TrustPay KYC approved does not update an existing Monnify account.
- The provisioning input also accepts explicit BVN/NIN overrides. Before production, enforce that these are the same verified identities rather than trusting replacement identifiers supplied by a client.

## Monnify requirements and connection

For customer reserved accounts, Monnify documents linking BVN or NIN, and both for its maximum-limit option. TrustPay's both-checks rule is stricter than the single-identifier option. Do not equate TrustPay Tier 2 with an automatically granted Monnify transaction limit.

New accounts: verify the customer's identity, then POST `/api/v2/bank-transfer/reserved-accounts` with a stable accountReference, accountName, customerName, customerEmail, currencyCode NGN, contractCode and verified bvn/nin. Save the returned account only after a successful response. Monnify performs its own checks; a Ninja approval is not a substitute for the identifiers or a guarantee of Monnify approval.

Existing accounts: PUT `/api/v1/bank-transfer/reserved-accounts/{accountReference}/kyc-info` with verified bvn/nin. Implement a durable, retryable sync record keyed by account and identity version, record success/failure safely, and never label the external sync complete before Monnify confirms it. Keep identifiers encrypted, out of logs, and out of Flutter responses.

Sources:
- https://developers.monnify.com/docs/integration-guide-bvn-nin-update
- https://teamapt.atlassian.net/wiki/spaces/MON/pages/1057128525/Update+Reserved+Account+KYC+Info

## Beyond business-account activation

1. Obtain live API credentials and the correct live contract code; configure the live base URL server-side. Obtain live Ninja access and confirm its verification funding/entitlements with the provider.
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

No live provider configuration or customer identity was changed during this review. No real identity check, payment, or external account creation was submitted.
