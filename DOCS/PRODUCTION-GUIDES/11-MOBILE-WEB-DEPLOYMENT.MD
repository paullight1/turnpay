# Production Guide: Mobile And Web Deployment

## Scope

Use this guide for backend, website/admin, and Flutter mobile deployment. Local builds cannot prove production domains, TLS, app-store signing, push/deep-link behavior, live Supabase callbacks, provider webhook delivery, or mobile release approval.

## Required Env Vars

Backend:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=
REDIS_HOST=
REDIS_PORT=6379
REDIS_PASSWORD=
WEB_URL=
ADMIN_URL=
SENTRY_DSN=
LOG_LEVEL=info
```

Website/admin:

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
API_BASE_URL=
WEBSITE_BASE_URL=
```

## Sandbox Steps

1. Deploy backend to staging with staging database, Redis, Supabase, and provider sandbox keys.
2. Deploy website/admin to staging with staging API and Supabase public keys.
3. Build Flutter staging app with staging Supabase and API values.
4. Verify auth, dashboard, funding sandbox, virtual account sandbox, withdrawal sandbox, internal transfer, exchange, VTU, transaction history, and admin review.
5. Confirm CORS allows only approved staging origins.
6. Confirm Sentry captures controlled test errors without secrets.

## Live Steps

1. Configure production domains, HTTPS certificates, CORS origins, and provider webhook URLs.
2. Configure production secret manager values for backend, web, and mobile builds.
3. Run backend migrations and health checks before exposing traffic.
4. Deploy website/admin and verify public env vars do not contain secrets.
5. Build signed Flutter production artifacts with production Supabase and API values.
6. Complete app-store privacy, financial services, and data safety disclosures.
7. Release to internal testers first, then staged rollout.
8. Keep money movement flags disabled until live smoke tests and reconciliation pass.

## Verification Checklist

- [ ] Backend `/health` or equivalent is green in production.
- [ ] HTTPS is enforced for backend, website, admin, and webhooks.
- [ ] CORS production origins are explicit, not wildcard.
- [ ] Website bundle contains no secret keys.
- [ ] Mobile app stores tokens in secure storage and disables cleartext traffic.
- [ ] Production logs do not include secrets, OTPs, tokens, or full account numbers.
- [ ] Rollback plan exists for backend, web, mobile, and feature flags.
- [ ] Monitoring alerts cover API errors, webhook failures, queue failures, database, Redis, and provider outages.

## Launch Blockers

- Production build uses staging or local API URLs.
- Provider webhook URL still points to staging or localhost.
- Store review, signing, privacy declarations, or release ownership is incomplete.
- Feature flags are enabled before live smoke test and reconciliation.
- No rollback path for a bad deploy or provider incident.
