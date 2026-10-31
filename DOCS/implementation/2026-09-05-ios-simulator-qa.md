# iOS simulator QA — 5 September 2026

## Scope and build

Latest local working-tree app, Flutter 3.44.6 / Dart 3.12.2, Xcode 26.5,
iPhone 17 simulator on iOS 26.5. Android is excluded at the owner's request.
The app connects directly to the existing documented staging API at
`https://api.trustpayhq.com`. These results do not validate a distribution
build or a physical iPhone.

## Verified so far

- Fresh native Debug compilation succeeded. The app was installed over
  `com.trustpay.app`, preserving the existing account and local PIN state.
- The first unsigned installation reproduced an app-security error. The
  simulator's security service reported OSStatus `-34018`: the client had
  neither an application identifier nor Keychain access-group entitlement.
- Rebuilt successfully with local simulator signing enabled:
  `CODE_SIGNING_ALLOWED=YES`, `CODE_SIGN_IDENTITY=-`. Xcode embedded the
  simulated application identifier. After reinstall, the security error was
  replaced by the normal existing-PIN unlock prompt. No security check was
  bypassed and no stored credential was read or reset.
- Display name is now **TrustPay**; Face ID permission copy describes both
  app unlock and protected transaction approval.
- Home exchange copy now describes NGN→GHS and receipt/deposit confirmation,
  rather than promising a two-way exchange within minutes. Ten home widget
  tests passed before the native rebuild.
- Authentication actions use native Flutter button widgets with semantic
  button roles, keyboard activation, named loading states, and flexible
  height for large text. All three button regression tests passed after updating
  the deprecated semantics assertion. Fourteen registration/email-handoff
  regression tests passed. Final Flutter analysis reported no issues.

## Pending live checks

The owner entered the existing PIN directly and unlocked the new build. The
account has Tier 0 verification and zero wallet balances. Computer-use checks:

| Journey | Observed result |
| --- | --- |
| Saved session and PIN | Unlock succeeds after simulator signing correction |
| Dashboard | Initial network error; Retry recovered, account requests returned 200 |
| History | Correct empty state, no fabricated transactions |
| Profile/security | Loaded account and verification status |
| KYC | BVN/NIN selection loads; empty BVN rejected locally |
| Biometrics | Face ID reported unavailable, approval switch disabled |
| Receiving account | Staging provisioned an account; copy action confirmed success; no deposits |
| Airtime | Providers loaded; missing phone number rejected |
| Data | Provider packages and prices loaded |
| Electricity | Providers loaded; empty meter number rejected |
| Cable | Initial provider error recovered on Retry; empty card number rejected |
| Send money | Entry form loaded; empty amount rejected |
| Exchange | Both config and order-list endpoints returned HTTP 404 |
| Appearance | **Failed:** selecting Dark left the current screen light until navigation; mixed colors persisted |

These are entry, recovery and validation checks, not completed purchases or
financial settlements. No transfer, bill purchase, or identity verification
was submitted. A staging receiving account was provisioned; no money was sent.

Additional findings to resolve:

1. Deploy the manual-exchange backend, migrations and configuration. The
   current error screen inaccurately suggests a connection issue for a 404.
2. Fix theme propagation across active screens and controls; restore the
   original System preference after the test (done).
3. Reconcile receiving-account eligibility with the KYC messaging. Local
   backend code has an explicit non-production sandbox KYC bypass; confirm
   the deployed staging configuration before attributing this to a production
   authorization defect. Real production KYC enforcement remains unproven.
4. Refresh the home account summary after provisioning: it continued showing
   “Request account” when returning from a successful receiving-account flow.
5. Clearly label deferred international wallets; `****` currently looks like
   hidden financial data rather than unavailable functionality.

Receipt submission, admin approval, wallet credit, and external bank/MoMo
settlement are **not yet validated end to end on staging**. The previously
inspected staging database did not include migrations 036–038, which belong
to the new manual-exchange implementation. Deploying the matching backend,
migrations and configuration is a prerequisite for those live journeys.
Local financial and UI tests remain separate evidence.

## Evidence and limits

- `/tmp/trustpay-ios-compact-build.log`: first native compilation succeeded.
- `/tmp/trustpay-ios-signed-simulator-build.log`: corrected build succeeded.
- `/tmp/trustpay-ios-ux-home-test.log`: ten home widget tests passed.
- `/tmp/trustpay-ios-button-final-tests.log`: three button tests passed.
- `/tmp/trustpay-ios-registration-retry-tests.log`: fourteen registration and
  email-handoff tests passed after recovering disk space.
- `/tmp/trustpay-ios-final-analyze.log`: no issues found.
- Computer-use inspection confirmed the new build's PIN unlock and the
  authenticated journeys listed above.

Disk space was a material test-host constraint. Only this task's generated
compiler cache was removed to recover space. Existing account data and other
projects were preserved. Earlier screenshots from the old installed app are
not counted as validation of the latest app.

The prior **79/100** engineering assessment is unchanged by compilation alone.
Neither full feature coverage nor launch readiness has been established.
The new build remains installed. The temporary localhost staging relay used
by the old build was stopped after direct HTTPS staging access was verified.

## Second QA pass: issue register and fixes

Status distinguishes source/test verification from live transaction completion.
No score increase is assigned merely for closing presentation defects.

| ID | Severity | Reproduction / actual result | Resolution and evidence |
| --- | --- | --- | --- |
| IOS-01 | High | Unsigned simulator launch cannot access Keychain (`-34018`) | Fixed local simulator signing; existing PIN unlock verified |
| UI-01 | Medium | Select Dark; active page stays light until navigation | Widgets now register inherited-theme dependencies. Simulator verified Light→Dark and Dark→Light without navigation; form-state regression passes |
| UI-02 | Medium | Dark mode leaves iOS clock/status icons dark | Set iOS status-bar brightness; white clock/icons visually verified |
| UI-03 | Medium | Small helper text is faint on theme surfaces | Improved both hint palettes; contrast ≥4.5:1 verified on background, surface, variant and input fills |
| UI-04 | Medium | Deferred currency cards show `****` like hidden balances | Show “Coming soon”; simulator verified updated cards, compact-layout tests pass |
| UX-01 | Medium | Return home after account provisioning; “Request account” remains | Successful provisioning broadcasts wallet refresh; regression verifies refresh signal and account display. Existing provisioned account is visible after restart; another live provisioning was not performed |
| UX-02 | Medium | Exchange 404 tells customer to check their connection and promises order safety | Removed unsupported diagnosis/promise; advises retry/support before sending money. Backend deployment remains blocking |
| AUTH-01 | Medium | Network failure on auth bootstrap displays “session expired” | Separate network, server-unavailable and confirmed 401 messages; login/bootstrap/refresh regressions pass |
| AUTH-02 | Medium | Accessibility/keyboard activity does not reset inactivity clock | Observe those input events without consuming them; test confirms active input resets timer and 15 minutes of inactivity still locks |
| AUTH-03 | High | PIN overlay visually covers the dashboard but accessibility still exposes account content | Exclude protected semantics, focus and pointer interaction while loading/locked. Twelve focused lock tests pass; freshly installed native build exposes only the lock controls in computer-use inspection |
| UI-05 | Low | History and other detail screens say they are loading account settings | Generic loading description now matches shared detail screens |
| SUPPORT-01 | Low | Live-chat launch appears unresponsive while Safari opens | Added opening/failure feedback and duplicate-click prevention. Clean-start computer-use verification: opening feedback displayed, Safari loaded customer support, return to TrustPay succeeded; no message sent |
| SUPPORT-02 | Low | Issue dropdown shows raw enum names; copy exposes chat vendor | Readable category labels and direct customer-care wording |
| STAGE-01 | Partially resolved | Manual-order config/list return 404 | Backend 5cf36bd deployed; migrations 036–038 applied; new customer/admin routes now return 401 without auth. Authenticated live receipt and settlement journeys still require collection config, eligible customer and administrator |
| STAGE-02 | Explained in staging | Receiving account provisioned while profile says KYC required | Render confirms Monnify sandbox URL and explicit sandbox KYC bypass=true. Production eligibility enforcement still requires separate verification |
| STAGE-03 | Medium | Render ADMIN_URL ends in `.comm` | Corrected to `https://www.trustpayhq.com` using Save only; persisted value verified. Takes effect on subsequent deployment |
| STAGE-04 | Release blocker | Render free instance sleeps between requests | Dashboard warns first request can be delayed 50 seconds or more; production requires an always-on capacity decision |

Further computer-use checks completed: notification dismissal, notification→KYC
navigation, empty KYC history, account-details read, support FAQ and empty case
history, rejection of an empty case with the 20-character validation message,
readable support category labels, and external support page launch in Safari. No chat message or support
case was sent. The one-time identity edit, account deletion, PIN changes, funded
transfers, purchases, deposit webhooks, withdrawals, and exchange settlements
remain uncompleted live journeys; they are not marked passed.

Verification logs for this pass:

- `/tmp/trustpay-qa-full-tests.log`: 209 tests passed after the shared theme and
  account-refresh changes.
- `/tmp/trustpay-qa-lock-auth-tests.log`: 18 follow-up security/error tests passed.
- `/tmp/trustpay-qa-theme-final-tests.log`: 2 contrast/theme-state tests passed.
- `/tmp/trustpay-qa-latest-analyze.log`: clean analysis after support changes.

Development-session note: the changed chat function signature required a full
Flutter restart; hot reload briefly showed a stale-signature type error. A
clean restart recovered the dashboard. This is not evidence that a fresh
installed build has the same error. The final native build was compiled, installed
over the existing app and cold-launched successfully. The normal PIN screen
and its protected accessibility tree were verified using computer use.

Final evidence: `/tmp/trustpay-qa-final-regression.log` records **213 passing tests**;
`/tmp/trustpay-lock-final-tests.log` records **12 passing lock tests** after the
last privacy change; `/tmp/trustpay-qa-final-analyze.log` reports no issues;
`/tmp/trustpay-qa-lock-ios-build.log` records **BUILD SUCCEEDED**.

## Remaining end-to-end completion plan

| Priority | Journey | Required evidence before marking complete |
| --- | --- | --- |
| 1 | Exchange wallet settlement | Deploy matching staging backend and migrations; configure actual staging collection instructions; customer quote→receipt→awaiting confirmation→admin confirmation→one GHS wallet credit→matching history/ledger; retry must not duplicate credit |
| 1 | Exchange bank/MoMo settlement | Verified staging beneficiary fixture; quote→receipt→admin processing→recorded external payout→customer completed status; no simultaneous wallet credit |
| 1 | Funding and withdrawals | Confirm sandbox provider and KYC configuration; approved fixtures; deposit webhook→one wallet credit; withdrawal→approval→provider result→receipt; retry/reversal and balance reconciliation |
| 1 | Transfers and VTU purchase | Funded verified staging test accounts and approved test recipients/meters/cards; approval→server commit→provider status→history; lost-response recovery and duplicate-tap checks |
| 2 | Identity verification | Provider-approved sandbox BVN/NIN and OTP fixture; valid submission, rejection, retry and history. Do not use a real identity or change this account's one-time legal profile as a disposable fixture |
| 2 | Authentication and credentials | Owner-assisted sign-out/login, OTP/recovery, PIN change and reset; preserve private credentials and distinguish unavailable service from rejected authentication |
| 2 | Support and closure | Approved disposable support-case workflow and closure fixture; confirmation, persisted case reference, history and server result. No unsolicited case sent during this pass |
| 3 | Native release | Persist final build, cold-start and resume checks; physical iPhone biometric and privacy checks; signing, monitoring and operational release gates |

Staging deployment/admin access was requested to unblock the financial flows.
Until that dependency is resolved, the report records those journeys as blocked,
not passed. Android remains excluded from this simulator task as requested.


## Render deployment investigation and candidate

The owner supplied the existing signed-in Chrome service:
`https://dashboard.render.com/web/srv-d8ko94t8nd3s73besu2g`.
The service `turnpay` serves `api.trustpayhq.com`; its previous deployment was
`d26243f` from `paullight1/turnpay` main. Actual settings: Oregon free Docker
instance, root `BACKEND`, Dockerfile `./Dockerfile`, build context `.`.
The dashboard project label says Production, but the runtime NODE_ENV value is
`Staging` (the backend schema normalizes it). Monnify and VTpass URLs (this historical record predates the Monnify-only KYC cleanup)
were individually verified as sandbox; withdrawals=false, migrations-on-startup=true.
Secret values were not revealed or exported. The local render.yaml provider
URL/region differ from deployed settings, so the manifest is not authoritative
for the current service.

Backend-only candidate `5cf36bd0f7acabd04cc2e808e3c05b7e554cc109` contains 39
reviewed implementation/test/schema files and was pushed to
`paul/manual-exchange-launch`. Mobile/admin UI working changes remain local.
Candidate build and lint pass (`/tmp/trustpay-render-candidate-build.log`,
`/tmp/trustpay-render-candidate-lint.log`). Previous matching backend regression
evidence: 472 unit tests and 24 real-PostgreSQL financial tests.

A specific-commit Render staging deploy was requested. Render states that this
disables auto-deploy; the service remains configured for main. No merge to main
was performed. Manual Exchange remains disabled by default; no collection
instructions were invented. Render deployment
`dep-dadq080u01pc73brh4g0` reports **Deploy succeeded | Live**.
The database migration history confirms 036, 037 and 038 completed without rollback.
The four new manual-order/proof/event/allocation tables have RLS enabled.
The `exchange-receipts` bucket is private, limited to 8 MiB and JPEG/PNG/WebP/PDF.
These storage configuration checks do not replace an actual signed upload test.

Post-deployment checks on **both** `api.trustpayhq.com` and `turnpay.onrender.com`:

| Route | Unauthenticated result |
| --- | --- |
| `/api/health/ready` | 200 |
| `/api/exchange/manual-orders/config` | 401 (protected route now exists) |
| `/api/admin/exchange/manual-orders` | 401 (protected route now exists) |

The first check overlapped the old/new instance handover and returned one network
error and one old 404; the post-live repeat returned the results above. Do not
count the deployment-window responses as failures of the settled new deployment.

Render previously had no application health-check path. It is now saved as
`/api/health/ready`; the persisted setting was verified in computer use.
`ADMIN_URL` is corrected in the environment used by this deployment. The bare
API root returning 404 is not a Flutter screen or website failure.

The latest simulator remains installed at its normal PIN screen. The owner was
asked to unlock it privately and sign in to the app's admin dashboard. Dedicated
collection instructions were requested; no new auth role, KYC bypass, identity
change, receipt, wallet credit, payout or customer-support message was created.
The new admin Exchange UI remains local and also needs an authenticated test
preview/deployment before the full operator journey can be certified.


## Follow-up: unlocked Exchange and local admin

Local admin development server started at `http://localhost:3001`, using
`NEXT_PUBLIC_API_URL=https://api.trustpayhq.com` (the API client appends `/api`).
The current admin source route is `/admin/exchange/manual-orders`; a separate
login tab was opened without changing the owner's registration form.

Simulator retry diagnostics showed authenticated config and order-list responses
returning 200. Subsequent computer-use inspection, including reopening Exchange
from Home, shows the expected disabled-feature state rather than the generic
loading error. Temporary diagnostics were removed; no parsing change was needed.
Manual Exchange stays disabled pending dedicated collection-account configuration.
No full order/receipt/admin-credit/payout is yet certified.


## Follow-up: separate staff authentication

The owner chose email-only staff registration for support@trustpayhq.com after
the customer signup phone number conflicted with an existing account. Added
`/staff` with work-email verification through Supabase, no phone or transaction
PIN, persistent errors and retry idempotency. Customer signup now explains known
phone/email conflicts instead of collapsing them into a generic failure.

Admin authorization is enforced in backend guards and web bootstrap checks:
DB-assigned ADMIN, or a current Supabase-verified exact @trustpayhq.com email
matching the account. Unconfirmed email, lookalike domains, subdomains and
user-editable metadata cannot grant access. Suspended accounts remain blocked.
No customer role was promoted and email verification was not bypassed.

Backend commit `b45ed2de8dca5f87fad336ce2b24fc48bfab9b80` is live on Render
(deployment `dep-daduagf40ujc73d12ju0`), verified through computer use. Post-live
checks returned readiness 200, anonymous admin endpoint 401 and invalid staff
registration body 400. No pending database migrations. Website changes remain
local at http://localhost:3001/staff and are not published.

Validation: 50 focused auth/idempotency tests passed; the full backend run had
480 passing tests and one outdated controller assertion, subsequently corrected
and verified with all 9 controller tests passing. Backend build/lint and website
TypeScript/selected lint passed. All 5 new staff browser/helper checks passed
across focused runs. Actual email delivery, confirmation and authenticated admin
entry remain pending the owner's private password entry and email verification.
The staff signup page is open with the work email filled in.

Overall readiness stays 79/100: the financial receipt-to-admin-credit/payout
journey is still unverified and collection-account configuration remains pending.

## Follow-up: staff session and admin navigation — verified in browser

The earlier missing-`expires_in` diagnosis and commit `08c264d` were insufficient.
Inspection of the installed Supabase SDK confirmed that `setSession` calculates
`expires_in` as `exp - Date.now()/1000`, which produces fractional seconds.
Our integer-only schema rejected valid sessions with HTTP 400. The route now
accepts fractional values and normalizes its stored TTL using `expires_at`,
while retaining token verification before issuing the HttpOnly cookie.

Additional fixes:

- Session state is exposed only after successful persistence. Supabase sign-in
  events cannot bootstrap an admin profile during a failed cookie handoff.
  Failed login clears state and invalidates outstanding profile responses.
- Signed-in staff see their account, Open admin panel and Sign out, without a
  duplicate password form or stale sign-in error.
- Server-side bootstrap checks in the proxy, admin layout and session route now
  send the backend-required Idempotency-Key. Missing keys previously redirected
  successfully authenticated staff back to the login screen.
- Restarted the local dev server after it served a stale validator. The old
  disposable cache was moved to `/tmp/trustpay-next-dev-before-session-fix-20260905`.

Computer-use verification with the actual staff account reached Operations
control center, opened Manual exchange queue (empty, no order mutation), and
loaded `/admin` in a fresh browser tab using the stored session. The session
POST returned 200, followed by its confirmation GET. No credentials or tokens
were logged by the diagnostic code. Backend authorization rules remain intact.

All 11 focused staff/session checks pass, including regression cases first
observed failing, live-route fractional TTL rejection of an invalid token,
cross-origin denial, ghost profile prevention and the server redirect fix.
TypeScript and lint checks passed. Website fixes are running locally; no website
production deployment was performed. Financial receipt-to-settlement testing
remains pending collection configuration and eligible test account setup.

## Admin and customer workspace separation

Admin desktop and mobile navigation now show only Overview, Exchange requests,
Audit Trail, Service operations, Support Queue and KYC Review. The admin account
menu contains Sign Out, without personal Profile or Transactions shortcuts.
Customer wallet pages are not rendered for staff; backend-verified staff
capabilities redirect all `/dashboard` routes to `/admin`. Both customer-login
and staff-login entry points send staff directly to admin, and staff logout
returns to `/staff`. Customer accounts retain their existing wallet workspace.

Computer use verified real staff login landing in the admin workspace, the
oversight-only sidebar and account menu, and a direct `/dashboard/fund` visit
redirecting to `/admin`. All 20 focused session/staff tests pass, including eight
customer-route redirect regressions that failed before this change and a
customer-access preservation check. TypeScript and selected lint passed.
Changes are running locally; website production deployment remains outstanding.

### Customer access moved to mobile only

The subsequent product decision supersedes customer web access above. `/login`
now redirects to staff access; `/register` and customer workspace routes direct
customers to the app download page. Backend-verified staff visiting old workspace
URLs are redirected to admin. Customer login and registration forms and public
customer sign-in links have been removed. A server layout also prevents legacy
customer pages from rendering.

The website session endpoint rejects customer session creation, recovery and
refresh with HTTP 403 and clears cookies. Authorization uses backend bootstrap
capabilities, never client-supplied role metadata. Shared mobile authentication
endpoints remain unchanged.

Exchange management now has a short heading, focused description, no overview
stat cards, and full-width rate controls. Computer use verified the signed-in
staff Exchange view and its administration-only navigation. The focused session,
staff and app-only tests passed; TypeScript and selected ESLint checks passed.
The full legacy customer-web test suite was not run and needs migration to the
new product scope. These website changes are local, not production deployed.
