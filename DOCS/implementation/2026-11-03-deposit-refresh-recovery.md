# Deposit delivery and balance refresh recovery

The owner reported a successful incoming Paystack dedicated-account payment with no wallet credit. Read-only provider inspection confirmed success. The durable webhook inbox and provider event both recorded a failure because the deployed Tier 1 policy was missing; no funding transaction or ledger credit had been committed. Refreshing the app could not repair that state.

The previously approved Tier 1 policy is 50,000 NGN per transaction, 50,000 NGN daily outflow, and 300,000 NGN maximum balance. The single-transaction setting is a TrustPay policy equal to the daily limit, not a separate statutory per-transfer figure. These values were saved to Dokploy, preserving all other environment settings. They require deployment before taking effect. This recovery does not remove KYC, balance ceilings, fraud holds, or independently verified provider confirmation.

## Backend repair

The signed webhook endpoint persists the event before scheduling an immediate asynchronous worker wake. A five-second recovery poll replaces the previous one-minute poll. Concurrent worker invocations coalesce within an instance; database claims and reference allocation still protect across instances. Provider verification, currency/customer/account matching, Decimal arithmetic, transactional credit, and financial audits remain authoritative.

Successful virtual-account and checkout credits enqueue a private deposit notification and branded email event in the same transaction. The stable funding transaction ID deduplicates both records. The email contains no account number, identifier, amount, or other personal financial details; users see the receipt inside the authenticated app. Delivery retries cannot roll back the money credit. The existing outbox now dispatches every five seconds.

Production currently has no email provider/from configuration. The owner has been asked which existing sender to use. Do not claim delivery or disable the existing customer receipt channel until its replacement is operational.

## App repair

Home checks the uncached wallet endpoint every five seconds while visible and active. Returning to Home or resuming the app triggers an immediate balance check. Only a changed balance triggers a full dashboard refresh. Polling pauses when hidden or disposed, does not overlap requests, and preserves the last confirmed balance during temporary outages. Pull-to-refresh supports both touch and mouse drag.

## Verification

- Backend full suite: 877 tests passed before the additional worker-wake regression; that regression separately passed with the two delivery regressions.
- Backend build and scoped ESLint passed. An isolated release based on main plus only these deposit files also built successfully.
- Disposable PostgreSQL: six webhook and Tier 1 cases passed, including concurrent duplicate delivery producing one credit, one email event, and one user notification.
- Flutter focused checks: 21 tests passed, including automatic refresh, resume refresh, pause, temporary failure preservation, mouse pull-to-refresh, shell caching, existing Home, and notification polling.
- Full Flutter validation and hosted recovery are recorded below when complete.
