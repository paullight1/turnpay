# 🚀 Backend Production Deployment — Fly.io

> **Guide ID:** `PROD-18-BACKEND`
> **Stream:** STREAM-INFRA Phase 1.4
> **Target Platform:** Fly.io (Johannesburg region `jnb`)
> **Last Updated:** 2026-05-31

---

## Why Fly.io?

| Factor | Why It Matters for TRUSTPAY |
|---|---|
| **Johannesburg region** | Closest infrastructure to Nigeria/Ghana users (~80ms latency) |
| **Docker-native** | Zero changes to existing `BACKEND/Dockerfile` |
| **Auto-HTTPS** | Let's Encrypt certs provisioned automatically |
| **`fly secrets`** | Built-in secret management, encrypted at rest |
| **Rolling deploys** | Zero-downtime deployments |
| **Cost** | ~$10-15/mo for 2 instances (vs $38+ on Render) |

---

## Pre-Deployment Checklist

### Before first deploy, verify:

- [ ] **All secrets generated and stored** (see `DOCS/PRODUCTION-GUIDES/17-SECRET-INVENTORY.md`)
  - [ ] `JWT_SECRET` — 256-bit, unique to production
  - [ ] `JWT_REFRESH_SECRET` — 256-bit, unique to production
  - [ ] `PII_ENCRYPTION_KEY` — 256-bit AES
  - [ ] `BANK_ACCOUNT_ENCRYPTION_KEY` — 256-bit
  - [ ] `DATABASE_URL` — production managed PostgreSQL
  - [ ] `REDIS_URL` — production managed Redis (auth + TLS)
  - [ ] All provider API keys (Monnify, VTpass, Ninja)
  - [ ] Supabase production keys
  - [ ] Sentry DSN

- [ ] **Database ready**
  - [ ] Managed PostgreSQL provisioned (see `16-PROVISIONING-GUIDE.md`)
  - [ ] SSL/TLS enforced
  - [ ] Connection pooling (PgBouncer) configured

- [ ] **Redis ready**
  - [ ] Managed Redis provisioned
  - [ ] Auth token set
  - [ ] TLS encryption enabled

- [ ] **DNS configured** (if using custom domain)
  - [ ] `api.trustpayhq.com` → Fly.io (CNAME to `trustpay-backend.fly.dev`)
  - [ ] SSL certificate auto-provisioned by Fly.io

- [ ] **Dockerfile reviewed**
  - [ ] `.dockerignore` exists (created with this guide)
  - [ ] Non-root user configured (see Dockerfile improvements below)

---

## Step-by-Step Deployment

### 1. Install Fly CLI

```bash
# macOS
brew install flyctl

# Linux
curl -L https://fly.io/install.sh | sh

# Verify
fly version
```

### 2. Authenticate

```bash
fly auth login
# Opens browser — sign up or log in
# First-time: fly auth signup (creates account, requires credit card)
```

### 3. Create the Fly App

```bash
cd BACKEND

# Create app (first deploy only)
fly launch --name trustpay-backend \
  --region jnb \
  --now \
  --ha=false
```

The `fly.toml` at `BACKEND/fly.toml` already has the full configuration. Fly.io will detect it automatically.

### 4. Set All Secrets

```bash
# Critical secrets — generate unique values per environment
fly secrets set JWT_SECRET="$(openssl rand -base64 32)"
fly secrets set JWT_REFRESH_SECRET="$(openssl rand -base64 32)"
fly secrets set PII_ENCRYPTION_KEY="$(openssl rand -hex 32)"
fly secrets set BANK_ACCOUNT_ENCRYPTION_KEY="$(openssl rand -hex 32)"

# Database & Redis
fly secrets set DATABASE_URL="postgresql://user:pass@host:5432/trustpay_db?sslmode=require"
fly secrets set REDIS_URL="rediss://default:password@host:6379"

# Supabase (production project)
fly secrets set SUPABASE_URL="https://xxxxx.supabase.co"
fly secrets set SUPABASE_PUBLISHABLE_KEY="eyJhbGciOi..."
fly secrets set SUPABASE_ANON_KEY="eyJhbGciOi..."
fly secrets set SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOi..."
fly secrets set SUPABASE_JWT_SECRET="production-jwt-secret"

# Web URLs (production frontends)
fly secrets set WEB_URL="https://www.trustpayhq.com"
fly secrets set ADMIN_URL="https://www.trustpayhq.com"

# Payment Providers
fly secrets set MONNIFY_API_KEY="MK_PROD_..."
fly secrets set MONNIFY_SECRET_KEY="MS_PROD_..."
fly secrets set MONNIFY_CONTRACT_CODE="..."
fly secrets set MONNIFY_BASE_URL="https://api.monnify.com"
fly secrets set MONNIFY_WEBHOOK_URL="https://api.trustpayhq.com/api/webhooks/monnify"

# VTU Provider
fly secrets set VTPASS_API_KEY="..."
fly secrets set VTPASS_PUBLIC_KEY="..."
fly secrets set VTPASS_SECRET_KEY="..."
fly secrets set VTPASS_BASE_URL="https://vtpass.com/api"
fly secrets set VTPASS_WEBHOOK_SECRET="..."

# KYC Provider — Ninja is the active Nigerian provider and is a direct API;
# there is no Ninja webhook URL or client-facing provider choice.
fly secrets set KYC_PROVIDER="ninja"
fly secrets set NINJA_CLIENT_KEY="..."
fly secrets set NINJA_CLIENT_SECRET="..."
fly secrets set NINJA_BASE_URL="https://api.ninja.boucloud.io"

# OTP delivery — deployed environments use Twilio and never a development OTP.
fly secrets set SMS_PROVIDER="twilio"
fly secrets set TWILIO_ACCOUNT_SID="AC..."
fly secrets set TWILIO_AUTH_TOKEN="..."
fly secrets set TWILIO_PHONE_NUMBER="+234..."
fly secrets set OTP_EXPIRES_IN="5m"
fly secrets set OTP_LENGTH="6"
fly secrets set OTP_DEV_CODE=""

# Feature Flags
fly secrets set BANKING_ENABLED="true"
fly secrets set VIRTUAL_ACCOUNTS_ENABLED="true"
fly secrets set BANKING_SANDBOX_MODE="false"
fly secrets set BANKING_PROVIDER_PRIMARY="monnify"
fly secrets set VTU_ENABLED="true"

# Sentry
fly secrets set SENTRY_DSN="https://...@sentry.io/..."

# Transaction PIN
fly secrets set TRANSACTION_PIN_REQUIRED="true"

# KYC
fly secrets set KYC_DOCUMENT_BUCKET="kyc-documents"
fly secrets set PII_KEY_VERSION="1"

# Verify all secrets are set
fly secrets list
```

### 5. Deploy

```bash
# First deploy (or after config changes). The release machine runs the checked
# in `release_command = "npx prisma migrate deploy"` before serving machines
# receive traffic. `RUN_MIGRATIONS_ON_STARTUP=false` avoids a second concurrent
# migration attempt during rolling deploys.
fly deploy

# For production HA (2+ instances)
fly scale count 2

# Check status
fly status
```

### 6. Set Up Custom Domain (Optional)

```bash
# Add custom domain — Fly provisions SSL automatically
fly certs create api.trustpayhq.com

# Verify DNS
fly certs show api.trustpayhq.com
# Then add the CNAME record in your DNS provider
```

---

## Post-Deployment Verification

### 1. Health Check

```bash
# Should return 200 with JSON body
curl -s https://trustpay-backend.fly.dev/api/health | jq

# Expected response:
# {
#   "status": "ok",
#   "checks": { "database": "connected", "redis": "connected" },
#   "timestamp": "2026-05-31T..."
# }
```

### 2. Swagger Disabled

```bash
# Should return 404
curl -s -o /dev/null -w "%{http_code}" https://trustpay-backend.fly.dev/api/docs
# Expected: 404
```

### 3. HTTPS Enforced

```bash
# HTTP should redirect to HTTPS
curl -s -o /dev/null -w "%{http_code} %{redirect_url}" http://trustpay-backend.fly.dev/
# Expected: 301 https://trustpay-backend.fly.dev/
```

### 4. CORS Protected

```bash
# Request from unauthorized origin should be rejected
curl -s -o /dev/null -w "%{http_code}" \
  -H "Origin: https://evil.com" \
  https://trustpay-backend.fly.dev/api/health
# Expected: non-2xx (CORS rejection) — or 200 with no Access-Control-Allow-Origin header
```

### 5. Rate Limiting Active

```bash
# Hit the API 11 times in quick succession
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "Request $i: %{http_code}\n" \
    https://trustpay-backend.fly.dev/api/health
done
# 11th request should return 429 (Too Many Requests)
```

### 6. Logs Flowing

```bash
# Check live logs
fly logs

# Should see:
# - NestJS bootstrap logs
# - Prisma connection success
# - Redis connection success
# - Any incoming request logs
```

### 7. Auth Endpoint Works

```bash
# Login should work (returns JWT tokens)
curl -s -X POST https://trustpay-backend.fly.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@trustpay.com","password":"AdminPass123!"}' | jq

# Expected: { "accessToken": "...", "refreshToken": "..." }
```

---

## Environment Variable Reference

All env vars required by the backend. See `DOCS/PRODUCTION-GUIDES/17-SECRET-INVENTORY.md` for the full secret inventory.

| Variable | Required | Set Via | Notes |
|---|---|---|---|
| `NODE_ENV` | Yes | `fly.toml` [env] | Always `production` |
| `PORT` | Yes | `fly.toml` [env] | Always `3000` |
| `SENTRY_DSN` | ✅ Yes | `fly secrets` | HTTPS error-tracking DSN |
| `DATABASE_URL` | ✅ Yes | `fly secrets` | Managed PostgreSQL, SSL |
| `REDIS_URL` | ✅ Yes | `fly secrets` | Managed Redis, TLS |
| `JWT_SECRET` | ✅ Yes | `fly secrets` | 256-bit, rotate quarterly |
| `JWT_REFRESH_SECRET` | ✅ Yes | `fly secrets` | 256-bit, rotate quarterly |
| `PII_ENCRYPTION_KEY` | ✅ Yes | `fly secrets` | 256-bit AES |
| `BANK_ACCOUNT_ENCRYPTION_KEY` | ✅ Yes | `fly secrets` | 256-bit |
| `WEB_URL` | ✅ Yes | `fly secrets` | Production frontend URL |
| `ADMIN_URL` | ✅ Yes | `fly secrets` | Production admin URL |
| `SUPABASE_URL` | ✅ Yes | `fly secrets` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | `fly secrets` | Supabase anon key |
| `SUPABASE_ANON_KEY` | Yes | `fly secrets` | Supabase anon key (fallback) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Yes | `fly secrets` | Supabase service role |
| `SUPABASE_JWT_SECRET` | No | `fly secrets` | Supabase JWT secret |
| `MONNIFY_*` (6 vars) | ✅ Yes | `fly secrets` | Monnify production keys |
| `VTPASS_*` (4 vars) | No | `fly secrets` | VTU provider keys |
| `NINJA_CLIENT_KEY`, `NINJA_CLIENT_SECRET` | ✅ Yes | `fly secrets` | Ninja server credentials |
| `NINJA_BASE_URL` | ✅ Yes | `fly.toml` / `fly secrets` | `https://api.ninja.boucloud.io` in production |
| `SMS_PROVIDER`, `TWILIO_*` | ✅ Yes | `fly secrets` | Twilio OTP delivery; no development OTP override |
| `OTP_EXPIRES_IN`, `OTP_LENGTH`, `OTP_DEV_CODE` | ✅ Yes | `fly.toml` / `fly secrets` | `5m`, `6`, and empty respectively |
| `BANKING_ENABLED` | No | `fly secrets` | Feature flag |
| `BANKING_SANDBOX_MODE` | No | `fly secrets` | Must be `false` in prod |
| `TRANSACTION_PIN_REQUIRED` | No | `fly secrets` | Must be `true` in prod |
| `KYC_DOCUMENT_BUCKET` | No | `fly secrets` | Supabase bucket name |
| `PII_KEY_VERSION` | No | `fly secrets` | Key version for rotation |
| `ENABLE_SWAGGER` | No | `fly.toml` [env] | `false` in production |

---

## Scaling

### Vertical (More Resources Per Machine)

```bash
# View current VM size
fly scale show

# Upgrade — recommended for production
fly scale vm shared-cpu-1x --memory 1024   # 1 GB RAM

# Heavy load
fly scale vm performance-1x                 # Dedicated CPU, 2 GB RAM
```

### Horizontal (More Instances)

```bash
# High availability (2 instances minimum)
fly scale count 2

# View instance distribution
fly status

# Scale to specific regions
fly regions add lhr   # London — backup region
fly regions add fra   # Frankfurt — backup region
```

---

## Rollback Procedure

### If a deploy breaks production:

```bash
# 1. View deployment history
fly releases

# 2. Rollback to previous stable version
fly releases rollback

# 3. Verify health after rollback
curl -s https://trustpay-backend.fly.dev/api/health | jq

# 4. Check logs for errors
fly logs --since 5m
```

---

## Monitoring & Alerting

### Fly.io Built-in

```bash
# Metrics dashboard
fly dashboard metrics

# Set up alerts
fly alerts create --type cpu --threshold 80
fly alerts create --type memory --threshold 85
```

### Sentry (Error Tracking)

Once `SENTRY_DSN` is set:
- Unhandled NestJS exceptions → Sentry
- Transaction tracing → Sentry Performance
- Alert on new unhandled errors

### Uptime Monitoring

Configure external uptime monitoring (Better Uptime / Pingdom) to hit:
- `https://trustpay-backend.fly.dev/api/health` — every 30s
- Alert if response time > 1s or status != 200

---

## Dockerfile Improvements (Recommended)

The existing Dockerfile at `BACKEND/Dockerfile` is solid but these changes are recommended for production fintech deployment:

### 1. Add Non-Root User

```dockerfile
# After the FROM node:22-alpine line in production stage:
RUN addgroup -g 1001 -S trustpay && \
    adduser -S trustpay -u 1001 -G trustpay

# Before CMD:
USER trustpay
```

### 2. Add HEALTHCHECK

```dockerfile
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
```

### 3. Add OCI Labels

```dockerfile
LABEL org.opencontainers.image.title="TRUSTPAY Backend"
LABEL org.opencontainers.image.description="NestJS API for TRUSTPAY fintech platform"
LABEL org.opencontainers.image.version="1.0.0"
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Health check fails | DB/Redis unreachable | Check `DATABASE_URL` and `REDIS_URL` secrets |
| 503 on deploy | Release migration failed | Inspect release-machine logs, correct the migration/database issue, and redeploy; do not bypass the release command |
| Slow responses | Instance too small | Scale VM to 1GB (`fly scale vm shared-cpu-1x --memory 1024`) |
| CORS errors in browser | WEB_URL/ADMIN_URL wrong | Update secrets with correct production URLs |
| Secrets not applying | Secrets need redeploy | `fly deploy` after setting secrets |

---

*Last updated: 2026-05-31 | Stream: STREAM-INFRA Phase 1.4*
