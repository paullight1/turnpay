# TRUSTPAY V1 — Supabase, Render, and Vercel Launch

The current deployment target is **free staging**, not production. Do not send
real customer, KYC, or financial traffic through this environment.

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
5. In Auth URL Configuration, set the site URL to `https://www.truspayhq.com` and
   allow the staging reset route `https://www.truspayhq.com/reset-password`.
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
8. Confirm the Blueprint attaches `api.truspayhq.com`, complete its DNS mapping,
   and verify `https://api.truspayhq.com/api/health/ready`.

If migration deployment fails, the API intentionally does not start. Correct the
database configuration or migration instead of bypassing the startup check.

### Spaceship DNS

1. Confirm Render shows the `api.truspayhq.com` custom domain declared by the
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
   - `NEXT_PUBLIC_API_URL=https://api.truspayhq.com/api`
   - `NEXT_PUBLIC_SUPABASE_URL=https://zsewjppvfcssqllfefsm.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>`
   - `NEXT_PUBLIC_SITE_URL=https://www.truspayhq.com`
4. Do not set `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, JWT secrets, payment
   secrets, or encryption keys in `NEXT_PUBLIC_*` variables.
5. Map `www.truspayhq.com` after the preview deployment passes.

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
