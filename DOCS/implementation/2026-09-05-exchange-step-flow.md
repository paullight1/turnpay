# Simple manual Exchange flow

Implemented a direction → amount → payout destination → receiving account → receipt flow in Flutter. Exchange and order details use flat sections without decorative card containers or shadows. Changing direction clears the old amount and recipient fields. Receipt submission remains pending until server-side admin review.

The backend accepts an optional NGN/GHS source currency, selects the corresponding configured collection account and rate, and credits the order's target currency. Existing NGN idempotency fingerprints remain compatible. The client defaults to NGN-only support when an older backend omits supportedSourceCurrencies.

Verification: 21 focused Flutter tests passed, including cedis-to-naira step navigation. Selected Flutter analysis and backend TypeScript checks passed before the final recipient-reset change. Financial PostgreSQL integration tests could not run because FINANCIAL_TEST_DATABASE_URL is not configured; production balances were not used for testing.

Deployment remains outstanding for reverse exchange. Configure MANUAL_EXCHANGE_GHS_COLLECTION_BANK_NAME, MANUAL_EXCHANGE_GHS_COLLECTION_ACCOUNT_NAME, MANUAL_EXCHANGE_GHS_COLLECTION_ACCOUNT_NUMBER and MANUAL_EXCHANGE_GHS_COLLECTION_VERSION using the approved receiving details. Both directions need fresh operator-approved rates. Do not infer a rate or bypass the existing Tier 2 KYC requirement.

The simulator hot reload encountered an old in-memory configuration object after the model changed. The first clean rebuild failed from disk exhaustion. After user-authorized removal of cached application-update installers and npm downloads, available space reached 8.5 GiB. The iOS rebuild and launch then succeeded. Computer use verified the app is at its transaction-PIN unlock screen; the saved session refreshed successfully. All 21 Exchange tests passed again and selected Flutter analysis reported no issues. Unlocked visual verification and live receipt-to-admin confirmation remain outstanding.
