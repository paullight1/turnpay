# Email OTP and optional monitoring deployment

Owner request: make Sentry optional, replace Twilio with email OTP, deploy and complete KYC activation. This explicitly changes the earlier mandatory monitoring/SMS configuration. Preserve authentication, transaction PINs, KYC decision ownership, private documents, idempotency, audit, Redis limits and financial invariants.

Implementation choice: reuse the existing Supabase email delivery and provider-verified six-digit tokens. Require no new email vendor credentials. Email verification does not verify a phone or an identity document. Retain password login and password recovery links. Email challenges expire after five minutes with at most three attempts. Registration uses its existing confirmation email, with the code added to the template; resends use existing identities only. Provider clients never share mutable auth sessions.

- [x] Add failing configuration and email-provider/challenge tests.
- [x] Make Sentry optional but validate supplied HTTPS DSNs; require email OTP and reject deployed development codes.
- [x] Deliver/verify email OTP with bounded Redis challenges, validated email DTOs and the existing auth mutation idempotency.
- [x] Update registration, authenticated PIN reset and Flutter email-code UX.
- [ ] Configure Supabase templates/expiry and inspect real SMTP readiness; save Render email-provider configuration.
- [x] Run backend/Flutter checks and isolated PostgreSQL KYC acceptance.
- [ ] Ship the reviewed changes, apply normal additive migrations, verify public readiness and unsigned webhook rejection.
- [ ] Inspect genuine Paystack identity events and authenticated NIN admin access; report external provider/manual-review dependencies accurately.

No live identity result, document review or financial transaction will be fabricated. User sign-in is pending for Supabase dashboard settings.

Verification checkpoint: backend 636 tests across 90 suites passed; backend build and targeted ESLint clean. Flutter 401 tests passed and analyzer clean. Mobile release configuration shell tests passed with missing Sentry DSN/environment. All 60 financial integration cases across 9 suites passed against the explicitly disposable local PostgreSQL database and Redis DB 15, including six KYC API cases. A separate real Redis smoke verified the production email OTP Lua paths for TTL, three-attempt reservation, concurrent one-time consumption and replay denial, with only fake email delivery boundaries. No live email code, KYC outcome or financial transaction was fabricated. An independent release review is in progress. Saved and verified Render `OTP_PROVIDER=supabase_email` and removed the retired non-secret `SMS_PROVIDER`; no deployment yet. Supabase dashboard sign-in is still pending for templates, provider expiry and SMTP readiness.

Independent review completed. Fixed all six important findings: consistent Render/Fly/Compose email manifests and portable deployment gate; optional Compose Sentry; development-only local auth fallback (staging stays sessionless); atomic Redis challenge/counter reset; deployed Supabase URL/public-key prerequisites; uniform OTP request responses during provider failures. Observed failing staging/anti-enumeration/config tests and failing real Redis resend interleaving (four provider checks instead of three), then passing regressions. Final backend suite: 640 tests/90 suites passed. Final real PostgreSQL/Redis suite: 61 tests/10 suites passed. Mobile analyzer clean; 401-test Flutter run passed before the returning-user recovery addition; affected recovery/OTP widget tests passed, final full run pending. Manifest and mobile release guard shell tests passed. Minor deferrals: older unrelated deployment prose still mentions SMS; OTP internals retain legacy phone variable names; backend accepts HTTPS DSNs while mobile allowlists Sentry hosts.

The owner signed into the matching Supabase project. Custom SMTP was observed enabled. Saved Confirm sign up template with {{ .Token }}, five-minute copy and preserved {{ .ConfirmationURL }}. Magic Link/OTP template and provider expiry/length settings are not yet configured: Chrome disconnected again. The owner was asked to reconnect the extension in the signed-in Supabase/Render profile. No live verification message or identity approval was manufactured.
