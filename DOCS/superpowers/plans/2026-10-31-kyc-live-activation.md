# KYC delivery and reviewer activation

Goal: receive genuine Paystack identity results and let a designated, authenticated administrator review private NIN evidence.

Use the existing signed webhook inbox/worker and existing admin console. Preserve provider-owned BVN decisions, tier requirements, consent, private evidence, audit records and mutation idempotency. Do not manufacture provider success, approve real evidence automatically, or grant admin access to an inferred account.

- [x] Inspect the app, API, stored submission and provider records.
- [x] Check public delivery and server storage credentials: public API timed out; Render/Paystack require sign-in; local service-role key absent.
- [x] Add a dry-run-first, audited first-admin provisioning command restricted to an existing confirmed identity selected by the user.
- [x] Prevent competing NIN decisions from replacing a completed review or applying stale user tiers.
- [x] Exercise signed BVN delivery, replay protection, manual NIN approval/rejection, access guards and tier changes against disposable PostgreSQL.
- [ ] Verify private storage and public webhook delivery, register the stable URL in Paystack, and replay only matching genuine identity events if available.
- [x] Provision the explicitly designated reviewer and verify the active database role and audit record.
- [ ] Verify authenticated admin-console access and live delivery after deployment prerequisites are met.

External dependencies: user must identify the reviewer; dashboard sessions and private server storage credential must be available. A live accepted submission is not proof of a completed provider result. No live identity/financial test data will be fabricated.

Verification: 627 backend unit tests across 89 suites passed. Six API integration cases passed with real PostgreSQL in the explicitly disposable local database `trustpay_financial_test_kora_20261031`, using fake auth/provider/storage boundaries. They exercised real Nest guards, DTO validation, database idempotency, signature checking, durable webhook processing, audit records, private-evidence authorization, competing decisions, duplicate submission recovery and concurrent BVN/NIN tier updates. A delayed provider-response regression also verifies that an independently earned NIN tier survives submission completion. Backend build, built-image CLI help, targeted ESLint and diff whitespace checks passed. These checks do not prove live webhook delivery or a real private evidence upload.

The merchant's Webhook Events API returned no customer-identification success/failure events for the inspected date range. No event was replayed, no webhook dashboard setting was changed, and no real account was promoted. Both setup tabs are preserved for the user's sign-in.

## Activation follow-up

The owner explicitly nominated `trustpaylink@gmail.com` as the initial reviewer and signed into Paystack (in-app browser) and Render (Chrome Trustpay profile). The account exists in both the app database and Supabase Auth but its email is unconfirmed. The bootstrap command correctly refused promotion. At the owner's explicit request, the normal `/api/auth/resend-confirmation` flow sent a fresh signup confirmation; Supabase recorded a new confirmation-sent timestamp. No confirmation flag was set manually and no admin role has been assigned.

Matched the existing Render service-role credential to Supabase project `zsewjppvfcssqllfefsm`, verified it against the Auth admin API and configured it in the ignored local backend `.env` with mode 0600. The temporary credential transfer file was removed. The real private `kyc-documents` bucket has the intended 8 MiB limit and allowed MIME types. A synthetic document completed signed PUT upload, signed private GET with exact bytes and anonymous-access denial; the test object was removed. The local backend was restarted with this configuration and returned ready.

Saved `https://api.trustpayhq.com/api/webhooks/paystack` in the merchant's previously empty **Live Webhook URL** field and verified persistence after reload. No callback URL, key, transfer setting or Test webhook was changed. This establishes dashboard configuration, not delivery acceptance.

The Render service `turnpay` (`srv-d8ko94t8nd3s73besu2g`) is still serving its older release; the latest release `47642a3` failed startup with `SENTRY_DSN is required`. Its environment also lacks the Paystack secret and deployed Twilio/OTP settings. The browser-policy approval to copy the existing local Paystack live secret into this existing Render service was requested; monitoring/SMS credentials must be configured without weakening startup requirements. Live delivery and administrator activation remain pending these prerequisites.

The owner subsequently approved copying the existing Paystack live key into Render and setting `KYC_PROVIDER=paystack` / `BANKING_PROVIDER_PRIMARY=paystack`. Before any Render edit was made, Chrome disconnected and both browser and native computer-control attempts timed out. These settings have **not** been applied. The temporary prepared secret file was removed; approval remains applicable when the same operation can resume. The reviewer's email was still unconfirmed on the final Auth read. Further progress requires reconnecting browser control, email confirmation and the missing deployment credentials.

## Verified reviewer activation

After the owner confirmed email verification, the normal bootstrap command verified the current Supabase Auth identity, passed its dry run and provisioned `trustpaylink@gmail.com`. A separate database read confirmed `role=ADMIN`, an active account and exactly one `INITIAL_ADMIN_PROVISIONED` audit. No customer KYC tier or provider result was modified. Login synchronization preserves this explicitly assigned role; guards and bootstrap read the database role.

Chrome was not present in the connected browser inventory despite the reported reconnection. Both native Chrome entry points timed out, and the in-app browser recovery also failed with a closed transport. The already approved Render key/provider changes remain unapplied. Public API readiness still times out, and Paystack's identity event API returned no terminal events to recover. Required Sentry/Twilio configuration and restored browser control are outstanding external dependencies.

Started the existing admin console on loopback `http://127.0.0.1:3000`, explicitly pointed at the running local backend on port 3001. `/admin/kyc` responds with the expected HTTP 307 authentication redirect; the backend readiness endpoint returns HTTP 200. Authenticated UI inspection is still pending unavailable browser control and the user's normal sign-in. This local console does not establish public webhook delivery.

## Render configuration saved; service account handoff

Chrome control recovered through a fresh controlled tab. Saved the approved existing live Paystack key into the existing `turnpay` service, and independently compared the saved value with the approved local key without printing either. Saved and verified `KYC_PROVIDER=paystack` and `BANKING_PROVIDER_PRIMARY=paystack`. The save-only option was used; no deployment was triggered and unrelated environment settings were retained. Screenshot: `output/kyc-activation/render-paystack-saved.png`. The temporary credential transfer file was removed.

The owner confirmed that Sentry and Twilio accounts still need creation. Opened their official signup pages in the connected Chrome profile and preserved both for the owner. Account password entry and signup acceptance remain with the owner under the browser-control policy. Required next configuration is a real Sentry project DSN plus Twilio Account SID, Auth Token and an appropriate SMS sender, with `SMS_PROVIDER=twilio`, `OTP_LENGTH=6`, `OTP_EXPIRES_IN=5m` and no development OTP override. A trial account alone does not prove production SMS delivery. No monitoring or OTP startup checks were weakened. Public readiness still times out; live webhook delivery and authenticated admin UI acceptance remain unverified. Local preview processes are no longer listening on ports 3000, 3001 or 8080 at this checkpoint.

Also saved and verified the non-secret OTP settings in Render: `SMS_PROVIDER=twilio`, `OTP_LENGTH=6`, `OTP_EXPIRES_IN=5m`. Secret-field reveal is asynchronous; verification used the settled values returned by the UI, not the transient empty input immediately after revealing. Sentry/Twilio credentials are still absent, and no deployment was triggered. No application code changed in this follow-up.
