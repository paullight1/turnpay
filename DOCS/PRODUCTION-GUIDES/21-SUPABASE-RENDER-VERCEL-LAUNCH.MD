# TRUSTPAY V1 — Supabase, Render, and Vercel Launch

The default `render.yaml` blueprint is **free staging**, not production. Do not send
real customer, KYC, or financial traffic through that environment. These are repository
templates; confirm the actual host and settings of the running deployment separately.

- Supabase project `zsewjppvfcssqllfefsm`: staging Auth, PostgreSQL, and private Storage buckets.
- Render Frankfurt: the NestJS backend and a free, non-persistent Key Value instance.
- Vercel: the Next.js website and admin interface.
- Google Play and Apple App Store: Flutter distribution; the app calls the Render API.

Do not provision Render Postgres, DigitalOcean Postgres, or a PostgreSQL container
for production. Local and CI PostgreSQL remain valid for development and tests.

## 1. Supabase dashboard

1. Keep staging isolated from production customer data. Upgrade Supabase before live traffic.
2. Open the project and select **Connect → Session pooler**.
3. Copy the port `5432` connection string. Add
   `sslmode=require&schema=public` to its query string if missing.
4. If the database password is unknown, reset it in Database Settings and store
   it only in the deployment secret manager.
5. In Auth URL Configuration, set the site URL to `https://www.trustpayhq.com` and
   allow the staging reset route `https://www.trustpayhq.com/reset-password`.
6. Configure a production SMTP provider before relying on email confirmation or
   password reset delivery.
7. Confirm both Storage buckets remain private: `kyc-documents` and
   `exchange-receipts`.

Never expose the service-role key or database connection string to Vercel browser
variables or the Flutter application.

## 2. Render dashboard

1. Create a Blueprint from the repository-root `render.yaml` on branch `main`.
2. Confirm the Blueprint proposes exactly two free Frankfurt resources:
   `trustpay-backend` and `trustpay-redis`. It must propose no database and no
   `preDeployCommand`.
3. Enter every `sync: false` secret during initial Blueprint creation. For an
   existing Blueprint, enter them manually because Render does not resync these
   secret values.
4. Set `DATABASE_URL` to the Supabase session-pooler URL from step 1.
5. Set `SUPABASE_URL` to `https://zsewjppvfcssqllfefsm.supabase.co`, then set the
   publishable and service-role keys from the same Supabase project.
6. Keep the generated JWT and encryption keys in Render. Do not copy them into
   Vercel or the mobile application.
7. The free staging container runs `prisma migrate deploy` before starting the
   API because free services do not support pre-deploy commands.
8. Confirm the Blueprint attaches `api.trustpayhq.com`, complete its DNS mapping,
   and verify `https://api.trustpayhq.com/api/health/ready`.

If migration deployment fails, the API intentionally does not start. Correct the
database configuration or migration instead of bypassing the startup check.

### Spaceship DNS

1. Confirm Render shows the `api.trustpayhq.com` custom domain declared by the
   Blueprint. Add it manually only if this is an older service that did not sync
   the updated Blueprint field.
2. Copy the exact DNS target Render displays.
3. In Spaceship DNS, create a CNAME with host `api` and that Render hostname as
   the target. Do not include `https://` or a URL path.
4. Remove any conflicting `api` A, AAAA, or CNAME record.
5. Wait for Render to verify the domain and issue TLS before configuring provider
   callbacks.

## 3. Vercel dashboard

1. Import the Git repository and set the project root directory to `WEBSITE`.
2. Use the production branch `main`.
3. Set only public browser-safe variables:
   - `NEXT_PUBLIC_API_URL=https://api.trustpayhq.com/api`
   - `NEXT_PUBLIC_SUPABASE_URL=https://zsewjppvfcssqllfefsm.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>`
   - `NEXT_PUBLIC_SITE_URL=https://www.trustpayhq.com`
4. Do not set `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, JWT secrets, payment
   secrets, or encryption keys in `NEXT_PUBLIC_*` variables.
5. Map `www.trustpayhq.com` after the preview deployment passes.

## 4. Launch verification gates

- `npx prisma migrate status` reports every production migration applied.
- Supabase security advisors have no ERROR or WARN finding left unexplained.
- Registration, login, refresh, logout, and password reset work through Supabase Auth.
- KYC and receipt uploads remain inaccessible without authorization or signed URLs.
- Render Free Key Value can lose idempotency, OTP, and lockout state on restart;
  this is acceptable only for non-production staging.
- Web and mobile use only HTTPS endpoints and public Supabase keys.
- Payment, VTU, KYC, and webhook live flags remain disabled until each provider's
  production credentials and signature verification are certified.
- A backup restore drill and a low-value live reconciliation complete before
  increasing transaction limits.

Before production, upgrade both Render resources, enable Key Value persistence,
move migrations back to a paid `preDeployCommand`, set
`RUN_MIGRATIONS_ON_STARTUP=false`, and replace every sandbox credential and URL
with its live equivalent.


## Reviewed production proposal

`render.production.yaml` is a separate opt-in proposal. It uses paid web/Key Value plans, explicit persistent non-evicting Redis storage, production validation, a pre-deploy migration job and no startup migrations. Automatic deploys and financial feature flags are off. Applying the file creates paid resources; first review sizing, resource names, domain ownership, production isolation and the owner's chosen hosting platform. Do not attach the same API domain to staging and production simultaneously.

Set `REDIS_URL` manually to the reviewed authenticated production endpoint. The proposal deliberately does not inherit Render's default unauthenticated internal connection. Internal authentication, TLS/routing, access controls and multi-instance failure testing require actual service evidence. Render's internal authentication is a dashboard setting, and external TLS endpoints need a reviewed client allowlist; do not open access to all addresses to bypass setup. See [Render Key Value connections](https://render.com/docs/key-value) and [Blueprint fields](https://render.com/docs/blueprint-spec).

Select only one transactional delivery transport after verifying the sender: SMTP with `SMTP_REQUIRE_TLS=true`, or Resend with its backend-only key. Both Render templates and Compose pass through the supported settings. Keep `EMAIL_PROVIDER=disabled` until configured; outbox records remain queued. Supabase OTP/recovery SMTP remains independently configured and tested.

If production uses Dokploy or another approved host, use the same Docker startup validation and apply the same secret, release-job, persistent Redis, backup, TLS and provider gates there. Do not create a second production stack merely because a Render proposal exists.


Retain the existing Monnify API/secret/contract/base-URL settings only while legacy obligations remain. The production startup guard requires their live endpoint even with Paystack primary; new NGN activity still uses Paystack. Confirm the live credentials and endpoint in the existing secret store, following [Monnify's live-mode checklist](https://developers.monnify.com/docs/live).
