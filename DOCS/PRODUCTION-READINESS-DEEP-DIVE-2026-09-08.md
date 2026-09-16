# TRUSTPAY production readiness deep dive

Date: 8 September 2026. Assessment: **NO-GO for unrestricted real-money launch.**

This review covers the current backend, website, Flutter app, release automation, and operational documentation. Base commit: `5cffcb3d7f394e9eded4bf6aef88380a71d5d74c`, with substantial pre-existing uncommitted changes, including exchange execution and migration 039. Findings apply to this working tree, not necessarily to a deployed release. Application code was not changed during the audit.

The implementation has meaningful security and financial controls. Passing isolated checks does not establish that provider delivery, session containment, settlement, disaster recovery, or a signed mobile release works end to end. The confirmed account-security defects below are sufficient to withhold launch approval.

## Confirmed account-security findings

### R1 — High: backend logout does not revoke the Supabase session

Evidence: `BACKEND/src/auth/auth.service.ts:431`, `BACKEND/src/supabase/supabase.service.ts:73`, `APP/lib/services/auth_service.dart:132`.

The backend constructs a new Supabase client with a global Authorization header and calls `auth.signOut({ scope: 'local' })`. This client has no stored Auth session. The installed SDK's `_signOut` only calls the provider when `data.session.access_token` exists. A local reproduction using synthetic credentials and an intercepted fetch returned `{ error: null }` with **zero network calls**. No real credentials or external service was used.

The optional local refresh-token revocation does not revoke the provider token. Mobile then deletes local credentials and reports a completed logout. A copied provider refresh token remains outside that local protection. Website additionally attempts a client-side sign-out; the backend must enforce its own contract regardless of that extra attempt.

Required fix: perform provider revocation using an API that explicitly receives the verified access token, track completion/failure correctly, and revoke the corresponding application session. Verify that the old refresh token fails both through TRUSTPAY and directly through the provider after logout.

### R2 — High: device-session revocation only affects the application refresh-token table

Evidence: `BACKEND/src/auth/auth.service.ts:472`, `BACKEND/src/admin/admin.service.ts:426`, `BACKEND/src/auth/guards/jwt-auth.guard.ts:48`, `BACKEND/src/supabase/supabase.service.ts:63`.

The customer and admin session-revocation paths mark local refresh-token records revoked. They do not revoke the corresponding Supabase session. The protected-route guard verifies the provider identity and checks suspension, but does not consult these local revoked records. A client possessing a provider refresh token can bypass the application's refresh endpoint and continue using provider-issued access tokens. This defeats the intended lost-device containment control.

Required fix: associate application devices with provider session IDs, revoke the provider session, and enforce the selected revocation policy on protected routes. Test a captured token against a protected endpoint after customer and admin revocation, including direct provider refresh. Supabase documents the relationship between JWT `session_id` and provider sessions in its [session guidance](https://supabase.com/docs/guides/auth/sessions).

### R3 — High: changing a password fails with the current SDK client construction

Evidence: `BACKEND/src/auth/auth.service.ts:493`, particularly lines 512–519; `BACKEND/src/supabase/supabase.service.ts:73`.

Current-password verification runs on one client, but `auth.updateUser({ password })` runs on a newly created header-only client without an Auth session. The installed SDK requires a session before sending this request. The same synthetic reproduction returned **AuthSessionMissingError, HTTP 400, zero network calls**. Valid current credentials therefore do not make this password-change endpoint work.

Required fix: use an isolated authenticated client/session or an appropriate explicit-token operation, retain current-password verification, and verify password replacement and session invalidation end to end. Avoid solving this by sharing mutable user sessions between concurrent requests.

### R4 — High: phone OTPs are generated but never delivered

Evidence: `BACKEND/src/otp/otp.service.ts:104`, `BACKEND/src/auth/auth.service.ts:538`, `BACKEND/src/auth/auth.service.ts:655`.

`sendOtp` stores a code in Redis, logs a masked identifier, and returns “OTP sent successfully.” There is no SMS transport call or delivery queue in this path. Registration calls this service, and PIN recovery requires its OTP. Production disables the development OTP override, leaving customers unable to obtain the generated code.

Required fix: integrate the selected delivery service with observable delivery failures and bounded retry behavior. Keep rate limits, expiry, attempt limits, and one-time consumption. Prove delivery to a controlled test handset and successful PIN recovery without exposing the OTP in logs.

### R5 — High: company email ownership grants all administrator route permissions

Evidence: `BACKEND/src/auth/guards/jwt-auth.guard.ts:89`, `BACKEND/src/common/guards/roles.guard.ts:27`, `BACKEND/src/admin/admin.controller.ts:43`.

A verified `@trustpayhq.com` email sets `canAccessAdmin`, even when the database role is USER. `RolesGuard` treats this as satisfying ADMIN. The resulting access includes user administration and financial operations guarded by the same role. This is deliberate in the current code, but it is an excessive-privilege launch risk: a company mailbox is the effective grant of financial administration, and removing ADMIN alone does not remove this access.

Required fix: distinguish staff portal access from explicit operational permissions, use centrally managed grants and revocation, and require stronger authentication for privileged actions. Verify that a verified company-email USER cannot change customer roles, suspend accounts, or access financial operations without an explicit grant. If broad staff access is a product decision, record its owner and risk acceptance rather than treating domain verification as least privilege.

## Financial-control findings

### R6 — High: VTU ignores a reversal once the local purchase is SUCCESS

Evidence: `BACKEND/src/vtu/vtu.service.ts:108`, `:520`, `:970`, `:1034`.

Both webhook handling and requery stop when the transaction is no longer PENDING. The refund transaction also requires PENDING. Consequently, if a provider reverses a purchase after TRUSTPAY has recorded SUCCESS, the callback is treated as terminal without even confirming the updated provider state, and no compensating customer credit is possible through this path. The adapter recognizes reversed/refunded statuses, but the service cannot apply them to a successful purchase.

VTpass documents separate provider-bounced reversal notifications and a wallet-credit reference in its [reversal webhook contract](https://vtpass.com/documentation/transaction-reversal-webhook-api/). The code gap is confirmed; no actual live late-reversal was induced in this audit. Preserve the protection against stale failure callbacks, but authenticate and requery genuine reversal events, validate their relationship and amounts, and apply an exactly-once compensating ledger entry. Add SUCCESS → confirmed reversal and duplicate-reversal scenarios to certification.

### R7 — High: PIN replacement and its money-movement hold are not atomic

Evidence: `BACKEND/src/auth/auth.service.ts:680`, `BACKEND/src/common/services/transaction-pin.service.ts:65`, `:165`, `:176`.

PIN replacement explicitly writes `resetHoldUntil: null`; the one-hour hold is a second database operation after Redis cleanup. Concurrent money movement can verify the new PIN between these operations. A failure after the first write can leave the new PIN active without the hold even though the reset request failed. Write the credential and hold atomically, and coordinate the hold/credential checks with concurrent authorization. Test both an interrupted reset and a concurrent payment.

### R8 — Medium: reconciliation can report mismatches caused by concurrent valid transactions

Evidence: `BACKEND/src/common/services/reconciliation.service.ts:452` and `:472`.

Ledger aggregation and wallet reads use separate database snapshots. A valid ledger-and-wallet transaction committing between them produces a false discrepancy. Use a consistent database snapshot, or an explicit cutoff/retry strategy. This matters before connecting mismatch detection to an automatic stop.

### R9 — High control gap: BLOCKED reconciliation does not enforce a settlement hold

Evidence: `BACKEND/src/common/services/reconciliation.service.ts:22`, `:44`; `DOCS/PRODUCTION-READINESS/02-FINANCIAL-CONTROLS.md:16`.

The job persists BLOCKED and logs a warning. The reviewed money services do not consult that state to stop settlement. The local launch checklist explicitly requires an alert and settlement hold. Implement an actionable hold with a defined scope and audited clearance, and prove alert delivery to an owner. If a separate operational system provides this control, attach that evidence; it was not verified here.

## Deployment and operations findings

### R10 — High: the staging Blueprint targets live VTpass

Evidence: `render.yaml:15` and `:80`; `scripts/check-production-manifests.sh:71`.

The Blueprint sets NODE_ENV=staging while enabling VTU, disabling simulation, and selecting `https://vtpass.com/api`. The manifest check also expects this live URL. With valid live credentials, staging purchases can incur real provider charges; sandbox-only credentials would instead cause failures. Point staging at the sandbox host and validate provider-environment separation. This audit did not inspect installed credentials or submit a purchase.

### R11 — High: the backup script drops connection TLS settings and has unsafe default retention/storage

Evidence: `BACKEND/scripts/backup-db.sh:24`, `:36`, `:66`.

The script decomposes DATABASE_URL and invokes pg_dump with host/user/database arguments, discarding URI TLS parameters. It does not itself enforce equivalent SSL settings. It also defaults to `/tmp`, seven-day retention, and no explicit private umask or encrypted archive. Preserve and enforce TLS configuration, use private durable storage and encryption, and meet the repository's 30-day retention requirement. Actual database/server enforcement and external backup services were not inspected; plaintext traffic or data exposure is not claimed as observed.

### R12 — Release-path gap: Fly has no automatic migration step

Evidence: `BACKEND/fly.toml:92`, `BACKEND/scripts/start-production.sh:4`.

The startup script defaults migrations off and the checked-in Fly configuration lacks a release migration command. A deployment that relies on this path without a separate migration stage can start against an old schema. Establish an explicit migration gate for the chosen deployment platform. Render does explicitly enable startup migrations, so this finding is specific to Fly.

### R13 — Release packaging gap: migration 039 is outside the committed candidate

`BACKEND/prisma/migrations/039_exchange_quote_execution_guard/` is untracked, while related exchange and schema changes are uncommitted. This is work in progress, not proof of a deployed defect. Freeze and include the intended code and migration together; the exchange readiness note requires migration 039 before enabling the updated application.

Additional operational gaps to resolve or document:

- The production Compose file publishes HTTP ports 3000/3001. A separately managed TLS proxy/firewall may exist, but the file alone does not establish that boundary; verify and restrict direct origin access before using it publicly.
- Fly's deployment guide still selects Youverify, conflicting with the current Ninja-primary policy; the Monnify webhook guide includes obsolete domains. Correct the release runbooks against the chosen deployment path.
- The restore drill validates successful restoration and `SELECT 1`, but does not compare wallet/ledger/audit/provider evidence totals. Add representative financial-data assertions and measure recovery time.
- The Render Blueprint is explicitly free staging. A private dashboard Sentry setting, production promotion process, WAF, backups, or alert routing may exist elsewhere; none was certified by this repository review.

## Website and mobile findings

### R14 — High configuration gap: website server-side credential requests do not enforce HTTPS

Evidence: `WEBSITE/src/lib/server-auth-session.ts:125`, `WEBSITE/src/proxy.ts:44`, `WEBSITE/src/lib/config.ts:13`.

Server-side fetches build credential-bearing requests from NEXT_PUBLIC_API_URL. The explicit HTTPS guard only runs when `window` exists, so an HTTP production setting is accepted by the server routes/proxy. This is a misconfiguration exposure, not evidence that the deployed value is HTTP. Validate the shared API origin unconditionally for production before any bearer/refresh-token request.

### R15 — Medium: website logout ignores rejected cookie cleanup

Evidence: `WEBSITE/src/lib/supabase-session.ts:165`, `WEBSITE/src/app/api/auth/session/route.ts:247`, `WEBSITE/src/lib/auth-provider.tsx:409`.

Cookie deletion requires a valid CSRF pair. The caller sends no CSRF header when its in-memory token is absent and does not inspect HTTP failures. It clears local state regardless. In a missing/stale-CSRF or failed-cleanup path, the HttpOnly cookie remains despite the UI signing out. Recover the CSRF token and verify deletion; test reload after a failed cleanup. Provider revocation is a separate requirement covered by R1–R2.

### R16 — Medium release-path gap: generic Flutter web CI build lacks mandatory runtime configuration

Evidence: `.github/workflows/ci.yml:294`, `APP/lib/main.dart:69`, `:117`.

The generic CI job builds Flutter web in release mode without the required defines, while release startup rejects a missing SENTRY_DSN and requires Supabase configuration. Successful compilation of that output would not make it a usable release artifact. If Flutter web is a release target, supply validated configuration and smoke-test startup; otherwise classify this as a compilation-only check. The native release workflow has a separate configuration path.

Additional hardening and scope-dependent issues:

- `WEBSITE/next.config.ts:45` retains `unsafe-inline` for scripts. Migrate to nonces to strengthen XSS containment; this alone is not a demonstrated injection vulnerability.
- Mobile integrity checks are local heuristics, explicitly not server-verified attestation (`APP/lib/services/device_integrity_service.dart:43`). Add server-verified device signals if the risk model requires resistance to instrumented clients; local detection is already implemented.
- Biometric approval reuses an in-memory plaintext PIN (`APP/lib/services/transaction_security_service.dart:225`). It is not persisted at rest, but runtime instrumentation can recover it. Prefer a short-lived server challenge and OS-bound approval key; retain this as a documented residual risk until replaced.
- The legacy customer-web withdrawal page formats amounts to two decimals while sending an uncanonicalized number (`WEBSITE/src/app/dashboard/withdraw/page.tsx:76`, `:231`). The current customer-web policy routes customers to mobile, so this is a re-enablement gate rather than an active customer-launch blocker. Canonicalize amount input and request before restoring that flow.

## Verification performed

Controls already present include global DTO validation and idempotency handling; explicit production CORS and security headers; protected-route suspension checks; database-backed PIN credentials with failure limits; raw-body webhook capture and durable webhook inboxes; encrypted KYC identifiers; persisted reconciliation runs; and Redis readiness that fails closed outside explicitly enabled local fallback. These are useful implemented controls, not claims of complete attack coverage or operational certification.

| Check | Result | What it establishes |
|---|---|---|
| Backend `npm test -- --runInBand --silent` | 74 suites, 511 tests passed | Existing isolated behavior and regression assertions pass |
| Backend `tsc --noEmit --incremental false` | Passed | Backend TypeScript checks pass |
| Backend `npm run lint` | Passed | Backend lint gate passes |
| Website TypeScript and lint | Passed | Static website checks pass |
| Flutter analysis/tests | Not run: flutter/dart unavailable in the audit shell | No fresh mobile analyzer, test, or release-build claim |
| Backend and website production dependency audit | Zero vulnerabilities reported | Current `npm audit --omit=dev --audit-level=high` results, not a complete vulnerability assessment |
| Repository shell-script syntax checks | Passed | Shell syntax, not successful deployment/backup execution |
| Installed Supabase SDK logout reproduction | Success response, zero provider calls | Confirms the header-only logout defect |
| Installed Supabase SDK password-update reproduction | AuthSessionMissingError, zero provider calls | Confirms the header-only password-update defect |

These checks do not certify live credentials, provider permissions, applied migrations, production settings, or device behavior. Financial database integration tests, signed release builds, and live payment/identity operations were not run by this review.

Existing evidence is also relevant: `DOCS/EXCHANGE-READINESS-2026-09-06.md` records a prior disposable PostgreSQL run with 42 migrations, 31 financial tests, 29 exchange HTTP tests, and staff/customer-policy browser checks. Those are recorded earlier results, not tests rerun in this audit. That document explicitly leaves external API integration, target-environment migration, and deployed smoke testing open. Older audit documents contain superseded findings, so this report does not repeat them without checking current code.

## Release evidence still required

The repository's seven production-readiness workstreams describe required activities; unchecked checklists are not evidence that infrastructure is missing, and runbook presence is not evidence that it has been exercised.

Before approving a release, attach evidence for the exact candidate:

1. A frozen commit and migration/dependency manifest, with all intended working-tree changes included.
2. Staging migration application and drift checks; financial concurrency, retry, reversal, and reconciliation tests using a disposable database.
3. Provider acceptance for the enabled Monnify, Ninja, and VTpass products; reachable verified webhooks; successful and failed settlement scenarios. Sandbox observations must remain labeled sandbox.
4. Backup and restore of representative data, measured RPO/RTO, provider/Redis/database outage drills, alert delivery, and staffed incident ownership.
5. Signed Android/iOS artifacts and real-device checks for certificate pinning, integrity controls, upgrade/session behavior, offline retries, and critical money flows.
6. Staging security and load results, financial-control review, approved customer disclosures and launch-scope sign-off from the responsible business/compliance owners.
7. A controlled canary with low limits, defined rollback triggers, and a clean settlement/reconciliation cycle.

The governing local checklist is `DOCS/SECURITY-RULES.MD`; the release-evidence contract is `DOCS/PRODUCTION-READINESS/07-STAGING-CERTIFICATION-AND-GO-LIVE.md`.

## Recommended remediation order

| Priority | Work | Exit evidence |
|---|---|---|
| First | Session/logout containment, password changes, OTP delivery, explicit admin permissions | Real staging account can recover/change credentials; revoked device cannot refresh or access; ordinary staff denied privileged routes |
| First | VTU reversal lifecycle and atomic PIN reset hold | Provider-confirmed reversal credited exactly once; interrupted/concurrent PIN reset cannot permit spending |
| First | Separate staging/live VTpass and choose one production deployment path | Reviewed environment manifest; no live provider calls from staging; candidate migrations included and applied |
| Next | Snapshot-consistent reconciliation and effective settlement hold | Concurrent legitimate traffic causes no false mismatch; injected discrepancy stops intended settlement and alerts an owner |
| Next | Secure backup/restore and operational runbooks | Encrypted retained backup, verified TLS, representative financial restore checks, measured recovery, owner acknowledgement |
| Before public launch | Exact-candidate staging certification, signed device builds, business/provider approvals, canary | Written go/no-go record and clean settlement/reconciliation cycle |

Do not assign a readiness percentage from these checks: production readiness depends on closing specific defects and demonstrating the release gates, not on how many files or unit tests pass.
