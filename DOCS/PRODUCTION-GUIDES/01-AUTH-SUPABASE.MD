# Production Guide: Auth And Supabase

## Scope

Use this guide for Supabase project setup, backend Supabase credentials, website public auth config, Flutter auth config, JWT compatibility, and OTP/SMS behavior. Local development can validate code paths, but production requires live Supabase project settings, real callback domains, and SMS provider credentials.

## Required Env Vars

Backend:

```env
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
JWT_SECRET=
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=
JWT_REFRESH_EXPIRES_IN=7d
OTP_EXPIRES_IN=5m
OTP_LENGTH=6
OTP_DEV_CODE=
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=<secret>
TWILIO_PHONE_NUMBER=+15557122661
```

Website:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_WEBSITE_URL=
NEXT_PUBLIC_ADMIN_URL=
```

Mobile build:

```env
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
```

Never expose `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, SMS tokens, or OTP override values to the website or mobile app.

## Sandbox Steps

1. Create or select a non-production Supabase project.
2. Configure site URLs and redirect URLs for local/staging web and mobile deep links.
3. Use sandbox SMS credentials or a non-delivering OTP mode for development.
4. Keep `OTP_DEV_CODE` available only in local or isolated staging.
5. Verify signup, login, refresh, logout, password reset, OTP send, and OTP verify.
6. Confirm failed login and OTP rate limits.
7. Confirm JWT access tokens expire within 15 minutes and refresh tokens within 7 days.

## Live Steps

1. Create the production Supabase project and enable required auth providers only.
2. Configure production website, admin, and mobile callback URLs.
3. Store Supabase backend keys in the backend secret manager.
4. Store only publishable browser-safe keys in website and mobile builds.
5. Remove `OTP_DEV_CODE` from production.
6. Set `SMS_PROVIDER=twilio` and configure all three Twilio values in the
   production secret manager. Startup must fail closed if any is missing or
   invalid.
7. Configure live SMS sender approval, templates, and regional delivery rules.
8. Confirm Supabase Auth and local JWT strategy are intentionally aligned. If both exist, document which token is accepted by each backend guard.
9. Rotate any key copied through chat, local files, screenshots, or logs.

## Verification Checklist

- [ ] `SUPABASE_SERVICE_ROLE_KEY` is unavailable to website and mobile clients.
- [ ] Supabase RLS is enabled on every table exposed through Supabase APIs.
- [ ] Authorization decisions do not depend on user-editable `user_metadata`.
- [ ] Admin role claims come from trusted server-side data or app metadata.
- [ ] OTP expires in 5 minutes or less and allows no more than 3 attempts.
- [ ] OTP delivery returns success only after Twilio acknowledges a message; provider failures return a safe error and do not persist a new code.
- [ ] Twilio delivery has no automatic retry after an ambiguous timeout; clients reuse the original `Idempotency-Key`.
- [ ] Login, OTP, refresh, and password reset endpoints are rate limited.
- [ ] User deletion or suspension revokes active sessions where required.
- [ ] Logs do not include tokens, OTP codes, passwords, or Supabase secrets.

## Launch Blockers

- Production service-role key is present in frontend env vars.
- Supabase redirect URL mismatch blocks login or logout.
- OTP can be bypassed by a production `OTP_DEV_CODE`.
- JWT and Supabase auth modes are ambiguous for protected banking endpoints.
- RLS policies are missing or rely on mutable user metadata.
