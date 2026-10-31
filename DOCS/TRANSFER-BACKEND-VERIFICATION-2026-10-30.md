# Transfer backend verification — 30 October 2026

The Flutter transfer screens use `ApiClient` and the authenticated backend. Production transfer source contains no fake API adapter, hardcoded recipient identity, sample bank catalog or sample wallet balance. Test recipients/balances and simulated API responses remain in test files; preview images use those test fixtures.

## Request path

| Mobile operation | Real backend endpoint | Data source |
| --- | --- | --- |
| Available balance | `GET /api/wallets/:currency` | Authenticated wallet records; exact decimal balances |
| Bank list | `GET /api/payments/banks` | Active banking provider bank catalog |
| Account name | `POST /api/payments/banks/resolve` | Provider validation for the selected bank and account number |
| TrustPay recipient | `POST /api/transfers/recipient/preview` | Eligible database user, with privacy-preserving masked name/email |
| Availability | `GET /api/payments/capabilities` | Configured Paystack status, withdrawal flag/primary provider, internal-transfer switch |
| Bank transfer | `POST /api/payments/withdraw` | Server revalidates destination, enforces PIN/KYC/limits, reserves wallet funds and dispatches through the active provider |
| TrustPay transfer | `POST /api/transfers/internal` | Authenticated, PIN-approved, idempotent transactional ledger transfer |
| Uncertain outcome | `POST /api/payment-attempts/resolve` | Server reconciliation of the original attempt |

With the required Paystack primary configuration, account lookup delegates to the Paystack banking adapter and `PaystackClient`, which calls `https://api.paystack.co/bank/resolve`. No synthetic account name is returned if validation fails. Editing the bank, number or recipient email invalidates the previously displayed identity immediately. Manual unverified names cannot authorize payment.

The release API default remains `https://api.trustpayhq.com`, as confirmed by the user. Debug builds default to the local development backend; deployed testing requires `flutter run --dart-define=API_BASE_URL=https://api.trustpayhq.com` once the deployed service is healthy. Native release transport retains TLS/certificate-pin validation and authenticated requests.

## Corrections in this verification pass

- Exposed the real internal-transfer feature switch in payment capabilities, independent of Paystack availability.
- The mobile TrustPay flow now loads that capability and blocks submission when it is false, missing or unavailable. It displays retry guidance rather than presenting a disabled backend as ready to send.
- Paystack withdrawal capabilities no longer claim availability when the backend still selects the legacy Monnify primary. Existing legacy operations and credentials remain unchanged.
- Deploy the updated backend before the updated mobile client: older capability responses without `internalTransfers` intentionally disable TrustPay sending.

## Local environment and deployed-host findings

- No backend listener was available on local port 3001 during the audit.
- During the initial audit the local checkout had no Paystack secret, no explicit internal-transfer enablement and still selected the Monnify primary. By the subsequent backend check, local Paystack credentials were present and the real provider catalog check returned 287 banks in live mode. Secrets were not printed or changed by this verification.
- The confirmed host resolves and completes TCP/TLS. Public health probes received no HTTP response within 20, 45 and 55-second timeouts. A control HTTPS request returned HTTP 200. These observations do not establish the deployed service's configuration or health.
- No Render management credential or authenticated live verification session is available in this workspace. A Render deployment/startup/health-check error is required to diagnose the deployed service further.
- Real account-name acceptance still requires the healthy deployed API, its backend-side Paystack configuration and an authorized signed-in session/account to check. No secret should be put in mobile code or pasted into chat.

## Verification

- Backend follow-up: 578 tests passed across 79 suites. A separate TypeScript build passed and the actual compiled Nest application started with isolated real PostgreSQL/Redis.
- Transfer/provider focused backend checks: 93 passed in the initial audit; the later complete backend suite includes the new startup/health regressions.
- Real PostgreSQL + Redis integration: 12 passed, including exact cents, insufficient balance, concurrent transfers, same-key replay, post-commit process loss and Redis outage/recovery. An isolated local database and temporary Redis process were used; no production financial records were touched.
- Mobile transfer/recovery/validation checks: 53 passed.
- Focused Dart analysis: no errors; the existing unused funding helper warning remains outside this pass.
- Whole mobile suite: 273 passed, 1 existing unrelated failure: `kyc_verification_screen_test.dart` → `submits the identifier and exact date of birth`. Its checkbox finder matches two consent checkboxes; no transfer test failed.

No deployment, provider activation, feature-switch enablement or live-money transfer was performed. Automated fixtures verify behavior; they do not establish that a live Paystack merchant or the deployed API is operational. Configure and verify live operations through the existing deployment and [Paystack activation procedure](PAYSTACK-ACTIVATION.md).

## Backend startup follow-up

The global Redis rate limiter previously intercepted health requests. HTTP tests reproduced liveness returning 503 during Redis loss and readiness returning the limiter error instead of its dependency checks. Health endpoints now bypass that limiter; ordinary routes retain it. Database and Redis probes run concurrently with a two-second response deadline and share in-flight operations, preventing repeated probes from accumulating stalled driver operations.

The real compiled server was exercised against a newly migrated disposable PostgreSQL database and a temporary Redis process:

| Check | Observed result |
| --- | --- |
| Application startup | Passed |
| All database migrations | Passed |
| Liveness | HTTP 200 |
| Unauthenticated bank request | HTTP 401 |
| Readiness with deliberately absent provider credentials | HTTP 503; database and Redis connected, KYC misconfigured |
| Liveness after stopping Redis | HTTP 200 |
| Readiness after stopping Redis | HTTP 503; Redis disconnected |
| Ordinary financial route after stopping Redis | HTTP 503; distributed controls unavailable |

No provider key was supplied to the isolated startup server, so its readiness failure correctly demonstrates that missing provider configuration is not presented as healthy. The separate live Paystack bank-catalog check used the actual configured key and production provider classes; it returned 287 banks without any financial mutation or account lookup against an invented account.

Test fixtures now explicitly select their test Paystack key and legacy Monnify configuration, avoiding accidental dependence on local secret/provider changes. The log-redaction test checks request/response payloads rather than treating a coincidental PIN substring in a timestamp as a leaked PIN.

A clean Docker build was attempted but cancelled because the 8 GB host was under memory pressure. The cached image had a different dependency lockfile and was not substituted as proof. The verified startup used isolated compiled output (`tsc --project tsconfig.build.json --outDir /tmp/trustpay-backend-audit-build --incremental false`) and real local services. Temporary services/databases were removed afterward. This is not a Docker image-build certification.

The final public liveness probe to the confirmed API host still timed out. These backend corrections have not been deployed, and the live recipient-name lookup remains unverified through the deployed authenticated API.

## User-authorized local testing follow-up

The user selected the local backend for functionality testing and explicitly approved applying migration 041 to the configured Supabase database. Only migration `041_paystack_kyc_and_account_state` was pending. Prisma deployed it successfully; follow-up checks confirmed both Paystack tables, enabled RLS, deny-all direct client policies and the new unique webhook deduplication index. No payment was submitted.

The local backend runs on port 3001 with the current backend environment, live VTpass URL, simulation disabled, transaction PIN enforcement and local internal-transfer testing enabled. Readiness returns HTTP 200. Provider secrets remain backend-only. These are local runtime settings, not a production deployment or committed secret configuration.

The latest Flutter build is running on the iPhone 17 simulator with `API_BASE_URL=http://127.0.0.1:3001` and only public Supabase client configuration. The previous saved session was rejected with HTTP 401 during refresh, so the visible screen is onboarding/login; the user must sign in to inspect authenticated VTU and transfer screens.

A read-only call to the live VTpass balance endpoint returned code `027`, documented as IP not whitelisted. This prevents confirming local live VTU functionality until VTpass approves the testing backend's outbound IP. No provider wallet balance was disclosed and no purchase was attempted.
