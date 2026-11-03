# Deposit delivery and balance refresh recovery

The owner reported a successful incoming Paystack dedicated-account payment with no wallet credit. Read-only provider inspection confirmed success. The durable webhook inbox and provider event both recorded a failure because the deployed Tier 1 policy was missing; no funding transaction or ledger credit had been committed. Refreshing the app could not repair that state.

The previously approved Tier 1 policy is 50,000 NGN per transaction, 50,000 NGN daily outflow, and 300,000 NGN maximum balance. The single-transaction setting is a TrustPay policy equal to the daily limit, not a separate statutory per-transfer figure. These values were saved to Dokploy, preserving all other environment settings. The running Dokploy container confirmed all three values after deployment. This recovery does not remove KYC, balance ceilings, fraud holds, or independently verified provider confirmation.

## Backend repair

The signed webhook endpoint persists the event before scheduling an immediate asynchronous worker wake. A five-second recovery poll replaces the previous one-minute poll. Concurrent worker invocations coalesce within an instance; database claims and reference allocation still protect across instances. Provider verification, currency/customer/account matching, Decimal arithmetic, transactional credit, and financial audits remain authoritative.

Successful virtual-account and checkout credits enqueue a private deposit notification and branded email event in the same transaction. The stable funding transaction ID deduplicates both records. The email contains no account number, identifier, amount, or other personal financial details; users see the receipt inside the authenticated app. Delivery retries cannot roll back the money credit. The existing outbox now dispatches every five seconds.

Production currently has no email provider/from configuration. The owner selected Brevo SMTP and will create/connect the SMTP configuration. No Resend key was created. Paystack customer payment receipts were disabled as requested, and the unchecked setting persisted after reload; merchant receipts remain enabled. The deposit confirmation remains PENDING with zero attempts until SMTP is configured. Do not claim email delivery.

## App repair

Home checks the uncached wallet endpoint every five seconds while visible and active. Returning to Home or resuming the app triggers an immediate balance check. Only a changed balance triggers a full dashboard refresh. Polling pauses when hidden or disposed, does not overlap requests, and preserves the last confirmed balance during temporary outages. Pull-to-refresh supports both touch and mouse drag.

## Verification

- Final backend full suite: 878 tests passed, including asynchronous wake and worker coalescing.
- Backend build and scoped ESLint passed. An isolated release based on main plus only these deposit files also built successfully.
- Disposable PostgreSQL: six webhook and Tier 1 cases passed, including concurrent duplicate delivery producing one credit, one email event, and one user notification.
- Flutter focused checks: 21 tests passed, including automatic refresh, resume refresh, pause, temporary failure preservation, mouse pull-to-refresh, shell caching, existing Home, and notification polling.
- Final Flutter suite: all 500 tests passed; scoped analysis clean. The first broad run caught a Future-returning setState closure during mouse refresh and an unnecessary bootstrap on tab return; both were corrected and the complete suite rerun successfully.
- Hosted backend repair deployed successfully. The failed signed deposit had exhausted five attempts while policy was missing. An audited, narrowly matched operational retry reset that inbox row only after confirming the active policy; the normal worker independently verified Paystack and committed the ledger credit. No balance was manually changed.
- Read-back confirmed exactly one successful FUND transaction, one ledger CREDIT, PROCESSED inbox state, NGN 500 balance, and one PENDING deposit email with zero send attempts. The app displayed NGN 500 and Fund success without another page reload after the operational retry.
- Network observation confirmed repeated uncached HTTP 200 GET /api/wallets at approximately five-second intervals. Screenshots are local evidence only, excluded from git.

## Brevo SMTP owner setup

Set the following in Dokploy BACKEND → Environment, preserving existing variables. Use a sender/domain verified in Brevo; verification in another email provider does not establish Brevo verification.

```dotenv
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
EMAIL_FROM=TrustPay <YOUR_VERIFIED_BREVO_SENDER>
EMAIL_REPLY_TO=support@trustpayhq.com
SMTP_USER=YOUR_BREVO_SMTP_LOGIN
SMTP_PASSWORD=YOUR_BREVO_SMTP_KEY
```

The last two values belong only in protected deployment settings. Port 587 uses STARTTLS with mandatory TLS; certificate verification remains enabled. Save and redeploy, then verify outbox status and the actual recipient mailbox. A server accepting SMTP submission is not proof of inbox delivery. Ambiguous outcomes remain UNKNOWN rather than being blindly resent. [Brevo SMTP documentation](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP).
