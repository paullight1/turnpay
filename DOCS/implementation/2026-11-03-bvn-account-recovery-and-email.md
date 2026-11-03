# BVN confirmation, receiving-account recovery and email — 3 November 2026

The account setup failure was caused by the Paystack available-provider response using `provider_slug`. The adapter expected `bank_slug` or `slug` and rejected valid providers before account creation. Read-only diagnostics confirmed an already verified Tier 1 user, a verified Paystack customer binding and available providers. No live account was issued in this work.

## Resulting behavior

- The adapter accepts the official `provider_slug` and retains legacy response compatibility. Configured preferred banks must still be available. Recovery checks the customer's existing dedicated account before attempting creation; an incomplete returned account is treated as pending rather than permission to create another one. Disabled accounts remain blocked.
- A verified Tier 1 or Tier 2 user with verified Paystack BVN and saved consent can start setup immediately through the authenticated request flow. The provider lease protects concurrent attempts. A signed successful BVN callback also recognises consent saved after the original verification submission. Account assignment still depends on Paystack confirmation; a pending/202 response does not mean verification or account creation succeeded.
- Confirmed BVN creates one customer inbox event and one email-outbox event. Confirmed account readiness creates a separate pair. Event writes share the identity/account transaction, so state cannot commit without its durable notification. Repeated callbacks and account reuse do not create duplicate events. Already historical confirmations are not bulk backfilled or emailed.
- Flutter uses customer-safe recovery copy, preserves confirmed BVN, and separates identity waiting from account preparation. Verified saved requests offer **Continue setup**. Provider diagnostics are hidden in receiving-account, funding and account-management screens. Inbox events open the relevant verification or receiving-account screen.

## Email activation

The owner's requested sender is `support@trustpayhq.com`. The connected Resend account currently verifies `auth.trustpayhq.com`, not its parent domain. The choice between verifying the parent domain and using the verified subdomain remains pending. No DNS record, provider configuration, API key or live email was changed/sent.

Apply migration `054_transactional_email_outbox`, generate Prisma client and release the backend before enabling delivery. Install credentials privately in the backend deployment environment. Example non-secret settings after parent-domain verification:

```dotenv
EMAIL_PROVIDER=resend
EMAIL_FROM="TrustPay <support@trustpayhq.com>"
EMAIL_REPLY_TO=support@trustpayhq.com
```

Set `RESEND_API_KEY` through the deployment secret manager. For a future SMTP provider, choose `EMAIL_PROVIDER=smtp` and configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS=true`, `SMTP_USER` and `SMTP_PASSWORD` privately. Use implicit TLS on port 465 or STARTTLS on 587. Supabase Auth's OTP sender remains separate; its login API is not used as a transactional status-mail API. Do not put credentials in Flutter defines, chat, logs or source.

The minute worker requires scheduled jobs to be enabled. Missing/disabled configuration leaves events queued without consuming attempts. Activation may send accumulated queued events; inspect their age and intended audience before enabling a previously disabled environment. Delivery uses the current user's email address. No BVN, bank details or raw provider response appears in email content or logs.

## Delivery reliability and operations

Unique event keys prevent repeat event creation. Conditional database claims and bounded batches/concurrency prevent competing workers from sending the same row. Resend receives a stable outbox UUID as its idempotency key. Explicit temporary rejections retry with bounded backoff; permanent rejection or exhausted attempts becomes `EXHAUSTED`.

Network uncertainty, provider 5xx, lost worker leases and ambiguous SMTP completion become `UNKNOWN`. These are never automatically resent or failed over to another provider. Inspect the provider's delivery history before any manual remediation: SMTP cannot guarantee exactly-once delivery after an uncertain acceptance, and Resend's idempotency window is finite. `SENT` means accepted by the delivery provider, not guaranteed inbox arrival. `UNKNOWN`/`EXHAUSTED` need operational monitoring; there is no new admin mail-management UI or delivery-webhook tracking in this scope.

## Verification and release boundaries

- Backend unit suite: 836 tests / 109 suites passed before final presentation-only cleanup.
- Financial integration suite: 93 tests / 13 suites passed against isolated PostgreSQL `trustpay_financial_test_bvn_20261103` and ephemeral Redis port 16409. The task-owned Redis was stopped afterwards.
- Financial cases exercise signed callback replay, late saved consent, concurrent mail claims, notification-write rollback, ready-account recovery and Data API denial despite an explicit test-role grant. All use synthetic providers/transports.
- Final migration 054 applied cleanly only to the isolated test database. Production database was not migrated. RLS is enabled and direct PUBLIC/anon/authenticated access is revoked.
- Production TypeScript and targeted lint/UI results are recorded in the final verification notes below. Whole-repository test TypeScript checking has pre-existing errors in OTP mocks, Paystack webhook request typing, KYC recovery fixture typing and VTpass fixture narrowing; no repository-wide type-clean claim is made.

No real identity decision, account issuance, payment, payout, SMTP/Resend send, deployment, commit or push was performed. The existing hosted backend requires release before these code fixes affect actual requests.

### Final verification notes

- Production TypeScript: `npx tsc --noEmit -p tsconfig.build.json` passed.
- Targeted ESLint across changed banking, KYC, notification and financial-test files passed after formatting.
- Final focused backend rerun passed 36 tests in 5 suites, including outbox transport/claim/ambiguity cases and account request recovery.
- Final Flutter run passed 30 tests across account setup copy, wallet/receiving-account, notifications and home/funding screens. The verified-but-saved Receive Money regression failed before its copy/CTA correction and passed afterwards.
- Flutter analysis of 10 changed production/test surfaces and `git diff --check` passed.
- Logs are under `output/bvn-receiving-*`; generated evidence is not intended for source control. Browser inspection encountered stale connection-refused in-app tabs and no matching signed-in Chrome home tab. No fresh authenticated browser success or live end-to-end account issuance is claimed.
