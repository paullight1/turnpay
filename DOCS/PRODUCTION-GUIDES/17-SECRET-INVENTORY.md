# 🔐 Secret Inventory — TRUSTPAY Production

> **Guide ID:** `PROD-17-SECRETS`
> **Stream:** STREAM-INFRA Phase 1.3
> **Secret Manager:** Doppler (recommended) or Infisical (self-hosted alternative)
> **Last Updated:** 2026-05-31

---

## Secret Manager Recommendation: Doppler

| Factor | Doppler | Infisical | AWS Secrets Manager | Render Env Groups |
|---|---|---|---|---|
| **Free Tier** | 5 users, unlimited secrets | Self-hosted (free) | 30-day trial | Included with Render |
| **CLI Injection** | `doppler run -- npm start` | `infisical run -- npm start` | SDK only | N/A |
| **Audit Logs** | ✅ Built-in | ✅ Built-in | ✅ CloudTrail | ❌ |
| **Secret Rotation** | ✅ Automated | ✅ Automated | ✅ Lambda-based | ❌ Manual |
| **CI/CD Integration** | GitHub Actions native | GitHub Actions native | OIDC required | Render only |
| **Environment Diff** | ✅ Visual diff | ✅ Visual diff | ❌ | ❌ |
| **Encryption** | AES-256-GCM | AES-256-GCM | AWS KMS | At rest |

**Why Doppler:** Fintech-grade audit logging, zero code changes (`doppler run` injects env vars), native GitHub Actions integration for CI/CD, and visual diff between staging/production configs. The free tier covers TRUSTPAY's needs.

---

## Complete Secret Inventory (70 Variables)

### Legend
- 🚨 **CRITICAL** — Unique per environment, rotate quarterly, never in code
- 🔒 **SENSITIVE** — Never commit, use secret manager
- 📋 **CONFIG** — Non-sensitive, can be in env files
- 🅿️ **PROD** — Production only
- 🧪 **STAGING** — Staging only
- 🔄 **BOTH** — Both environments (different values)

---

### Section 1: Application Core (6 vars)

| # | Variable | Classification | Environment | Notes |
|---|---|---|---|---|
| 1 | `NODE_ENV` | 📋 CONFIG | 🔄 BOTH | `production` / `staging` / `development` |
| 2 | `PORT` | 📋 CONFIG | 🔄 BOTH | `3000` |
| 3 | `WEB_URL` | 📋 CONFIG | 🅿️ PROD | `https://trustpay.vercel.app` |
| 4 | `ADMIN_URL` | 📋 CONFIG | 🅿️ PROD | `https://trustpay.vercel.app/admin` |
| 5 | `ENABLE_SWAGGER` | 📋 CONFIG | 🅿️ PROD | Must be `false` in production |
| 6 | `SENTRY_DSN` | 🔒 SENSITIVE | 🅿️ PROD | Sentry project DSN for error tracking |

---

### Section 2: Database (5 vars)

| # | Variable | Classification | Environment | Notes |
|---|---|---|---|---|
| 7 | `DATABASE_URL` | 🚨 CRITICAL | 🔄 BOTH | Full PostgreSQL connection string with SSL |
| 8 | `POSTGRES_USER` | 📋 CONFIG | 🧪 STAGING | Docker-only, not used with managed DO |
| 9 | `POSTGRES_PASSWORD` | 🚨 CRITICAL | 🧪 STAGING | Docker-only; generate: `openssl rand -base64 32` |
| 10 | `POSTGRES_DB` | 📋 CONFIG | 🧪 STAGING | `trustpay_db` |
| 11 | `REDIS_URL` | 🔒 SENSITIVE | 🔄 BOTH | Full `rediss://` connection string |

---

### Section 3: Redis (3 vars)

| # | Variable | Classification | Environment | Notes |
|---|---|---|---|---|
| 12 | `REDIS_HOST` | 📋 CONFIG | 🔄 BOTH | DO Managed Redis hostname |
| 13 | `REDIS_PORT` | 📋 CONFIG | 🔄 BOTH | `25061` for DO Managed Redis TLS |
| 14 | `REDIS_PASSWORD` | 🚨 CRITICAL | 🔄 BOTH | DO Redis AUTH token; generate: `openssl rand -base64 32` |

---

### Section 4: Supabase Auth & Storage (5 vars)

| # | Variable | Classification | Environment | Notes |
|---|---|---|---|---|
| 15 | `SUPABASE_URL` | 📋 CONFIG | 🔄 BOTH | `https://xxx.supabase.co` |
| 16 | `SUPABASE_PUBLISHABLE_KEY` | 🔒 SENSITIVE | 🔄 BOTH | Anon key — exposed to frontend |
| 17 | `SUPABASE_ANON_KEY` | 🔒 SENSITIVE | 🔄 BOTH | Same as publishable (fallback) |
| 18 | `SUPABASE_SERVICE_ROLE_KEY` | 🚨 CRITICAL | 🅿️ PROD | Admin privileges — NEVER expose |
| 19 | `SUPABASE_JWT_SECRET` | 🚨 CRITICAL | 🔄 BOTH | JWT signing secret from Supabase dashboard |

---

### Section 5: JWT Tokens (2 vars)

| # | Variable | Classification | Environment | Notes |
|---|---|---|---|---|
| 20 | `JWT_SECRET` | 🚨 CRITICAL | 🔄 BOTH | 256-bit; `openssl rand -base64 32` |
| 21 | `JWT_REFRESH_SECRET` | 🚨 CRITICAL | 🔄 BOTH | 256-bit; `openssl rand -base64 32` |

---

### Section 6: Encryption Keys (3 vars)

| # | Variable | Classification | Environment | Notes |
|---|---|---|---|---|
| 22 | `PII_ENCRYPTION_KEY` | 🚨 CRITICAL | 🔄 BOTH | 256-bit AES; `openssl rand -hex 32` |
| 23 | `BANK_ACCOUNT_ENCRYPTION_KEY` | 🚨 CRITICAL | 🔄 BOTH | 256-bit AES; `openssl rand -hex 32` |
| 24 | `PII_KEY_VERSION` | 📋 CONFIG | 🅿️ PROD | `1` (increment on rotation) |

---

### Section 7: Banking — Monnify (11 vars)

| # | Variable | Classification | Environment | Notes |
|---|---|---|---|---|
| 25 | `BANKING_ENABLED` | 📋 CONFIG | 🔄 BOTH | `true` / `false` |
| 26 | `VIRTUAL_ACCOUNTS_ENABLED` | 📋 CONFIG | 🔄 BOTH | `true` / `false` |
| 27 | `BANKING_SANDBOX_MODE` | 📋 CONFIG | 🔄 BOTH | `false` in PROD, `true` in STAGING |
| 28 | `BANKING_PROVIDER_PRIMARY` | 📋 CONFIG | 🔄 BOTH | `monnify` |
| 29 | `BANKING_PROVIDER_FALLBACK` | 📋 CONFIG | 🔄 BOTH | Optional fallback provider |
| 30 | `SUPPORTED_BANKING_CURRENCIES` | 📋 CONFIG | 🔄 BOTH | `NGN` |
| 31 | `MONNIFY_API_KEY` | 🚨 CRITICAL | 🔄 BOTH | From Monnify dashboard |
| 32 | `MONNIFY_SECRET_KEY` | 🚨 CRITICAL | 🔄 BOTH | From Monnify dashboard |
| 33 | `MONNIFY_CONTRACT_CODE` | 🚨 CRITICAL | 🔄 BOTH | Virtual account contract code |
| 34 | `MONNIFY_BASE_URL` | 📋 CONFIG | 🔄 BOTH | Sandbox or live API URL |
| 35 | `MONNIFY_WEBHOOK_SECRET` | 🚨 CRITICAL | 🔄 BOTH | Webhook HMAC secret |
| 36 | `MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER` | 📋 CONFIG | 🅿️ PROD | Manual exchange receipt account |
| 37 | `MONNIFY_SANDBOX_TEST_KYC_BYPASS` | 📋 CONFIG | 🧪 STAGING | `true` in sandbox only |
| 38 | `MONNIFY_TEST_BVN` | 📋 CONFIG | 🧪 STAGING | Sandbox test BVN |
| 39 | `MONNIFY_GET_ALL_AVAILABLE_BANKS` | 📋 CONFIG | 🔄 BOTH | `true` |
| 40 | `MONNIFY_RESTRICT_PAYMENT_SOURCE` | 📋 CONFIG | 🔄 BOTH | `false` |
| 41 | `MONNIFY_WEBHOOK_URL` | 📋 CONFIG | 🅿️ PROD | Auto-registered webhook URL |

---

### Section 8: Payments — Paystack (3 vars)

| # | Variable | Classification | Environment | Notes |
|---|---|---|---|---|
| 42 | `PAYSTACK_SECRET_KEY` | 🚨 CRITICAL | 🔄 BOTH | `sk_live_...` in prod |
| 43 | `PAYSTACK_PUBLIC_KEY` | 🔒 SENSITIVE | 🔄 BOTH | `pk_live_...` in prod |
| 44 | `PAYSTACK_WEBHOOK_SECRET` | 🚨 CRITICAL | 🔄 BOTH | Webhook HMAC secret |

---

### Section 9: Payments — Flutterwave (4 vars)

| # | Variable | Classification | Environment | Notes |
|---|---|---|---|---|
| 45 | `FLUTTERWAVE_SECRET_KEY` | 🚨 CRITICAL | 🔄 BOTH | `FLWSECK_...` |
| 46 | `FLUTTERWAVE_PUBLIC_KEY` | 🔒 SENSITIVE | 🔄 BOTH | `FLWPUBK_...` |
| 47 | `FLUTTERWAVE_ENCRYPTION_KEY` | 🚨 CRITICAL | 🔄 BOTH | Payload encryption |
| 48 | `FLUTTERWAVE_SECRET_HASH` | 🚨 CRITICAL | 🔄 BOTH | Webhook verification |

---

### Section 10: VTU — VTPass (6 vars)

| # | Variable | Classification | Environment | Notes |
|---|---|---|---|---|
| 49 | `VTU_ENABLED` | 📋 CONFIG | 🔄 BOTH | Feature flag |
| 50 | `VTU_PROVIDER` | 📋 CONFIG | 🔄 BOTH | `vtpass` |
| 51 | `VTPASS_BASE_URL` | 📋 CONFIG | 🔄 BOTH | `https://api-service.vtpass.com` in prod |
| 52 | `VTPASS_API_KEY` | 🚨 CRITICAL | 🔄 BOTH | VTPass API key |
| 53 | `VTPASS_PUBLIC_KEY` | 🔒 SENSITIVE | 🔄 BOTH | VTPass public key |
| 54 | `VTPASS_SECRET_KEY` | 🚨 CRITICAL | 🔄 BOTH | VTPass secret key |
| 55 | `VTPASS_LOW_BALANCE_THRESHOLD` | 📋 CONFIG | 🔄 BOTH | Alert at NGN 5000 |

---

### Section 11: Feature Flags (4 vars)

| # | Variable | Classification | Environment | Notes |
|---|---|---|---|---|
| 56 | `TRANSACTION_PIN_REQUIRED` | 📋 CONFIG | 🔄 BOTH | Must be `true` in production |
| 57 | `EXCHANGE_REVIEW_REQUIRED` | 📋 CONFIG | 🔄 BOTH | Flag large exchanges for review |
| 58 | `WITHDRAWALS_ENABLED` | 📋 CONFIG | 🔄 BOTH | Feature flag |
| 59 | `BANKING_SANDBOX_MODE` | 📋 CONFIG | 🔄 BOTH | Must be `false` in production |

---

### Section 12: KYC & Document Storage (3 vars)

| # | Variable | Classification | Environment | Notes |
|---|---|---|---|---|
| 60 | `KYC_DOCUMENT_BUCKET` | 📋 CONFIG | 🔄 BOTH | Supabase bucket: `kyc-documents` |
| 61 | `KYC_ADMIN_DOCUMENT_URL_TTL_SECONDS` | 📋 CONFIG | 🔄 BOTH | Signed URL TTL: `300` |
| 62 | `PII_KEY_VERSION` | 📋 CONFIG | 🔄 BOTH | Active encryption key version |

---

### Section 13: Reconciliation & Webhooks (4 vars)

| # | Variable | Classification | Environment | Notes |
|---|---|---|---|---|
| 63 | `RECONCILIATION_CRON` | 📋 CONFIG | 🔄 BOTH | `0 */1 * * *` (hourly) |
| 64 | `WEBHOOK_QUEUE_NAME` | 📋 CONFIG | 🔄 BOTH | Redis key: `banking-webhooks` |
| 65 | `DLQ_NAME` | 📋 CONFIG | 🔄 BOTH | Redis key: `banking-dead-letter` |
| 66 | `ADMIN_REVIEW_WEBHOOK_ALERT_CHANNEL` | 📋 CONFIG | 🔄 BOTH | Slack/email for failed webhooks |

---

### Section 14: Website (Frontend) Env Vars (6 vars)

| # | Variable | Classification | Environment | Notes |
|---|---|---|---|---|
| 67 | `NEXT_PUBLIC_API_URL` | 📋 CONFIG | 🔄 BOTH | Backend API URL for frontend |
| 68 | `NEXT_PUBLIC_SUPABASE_URL` | 📋 CONFIG | 🔄 BOTH | Supabase URL |
| 69 | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 🔒 SENSITIVE | 🔄 BOTH | Supabase anon key |
| 70 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 🔒 SENSITIVE | 🔄 BOTH | Supabase anon key (fallback) |
| 71 | `NEXT_PUBLIC_MANUAL_EXCHANGE_BANK_NAME` | 📋 CONFIG | 🔄 BOTH | Manual exchange bank name |
| 72 | `NEXT_PUBLIC_MANUAL_EXCHANGE_ACCOUNT_NAME` | 📋 CONFIG | 🔄 BOTH | Manual exchange account name |
| 73 | `NEXT_PUBLIC_MANUAL_EXCHANGE_ACCOUNT_NUMBER` | 📋 CONFIG | 🔄 BOTH | Manual exchange account number |

---

## Summary by Classification

| Classification | Count | Handling |
|---|---|---|
| 🚨 CRITICAL | 21 | Doppler secret, unique per env, rotate quarterly |
| 🔒 SENSITIVE | 10 | Doppler secret, never in .env files |
| 📋 CONFIG | 42 | Doppler config, safe in .env.example with placeholders |
| **TOTAL** | **73** | |

---

## Production Key Generation

Run these commands ONCE and store results directly in Doppler. Never save to disk.

```bash
# JWT Secrets (256-bit)
openssl rand -base64 32   # JWT_SECRET
openssl rand -base64 32   # JWT_REFRESH_SECRET

# Encryption Keys (256-bit AES)
openssl rand -hex 32      # PII_ENCRYPTION_KEY
openssl rand -hex 32      # BANK_ACCOUNT_ENCRYPTION_KEY

# Database Passwords
openssl rand -base64 48 | tr -d '/+' | head -c 64  # PostgreSQL password
openssl rand -base64 32                              # Redis AUTH token

# Webhook Secrets
openssl rand -base64 32   # MONNIFY_WEBHOOK_SECRET
openssl rand -base64 32   # PAYSTACK_WEBHOOK_SECRET
openssl rand -base64 32   # FLUTTERWAVE_SECRET_HASH
```

---

## Doppler Setup

```bash
# 1. Install Doppler CLI
brew install dopplerhq/cli/doppler

# 2. Login
doppler login

# 3. Create project
doppler projects create trustpay

# 4. Create environments
doppler environments create staging --project trustpay
doppler environments create production --project trustpay

# 5. Set secrets (staging)
doppler setup --project trustpay --config staging
doppler secrets set JWT_SECRET="$(openssl rand -base64 32)" --config staging
# ... repeat for all secrets

# 6. Set secrets (production) — use DIFFERENT values!
doppler setup --project trustpay --config production
doppler secrets set JWT_SECRET="$(openssl rand -base64 32)" --config production
# ... repeat for all secrets

# 7. Run backend with Doppler
doppler run --config staging -- npm run start:dev
doppler run --config production -- npm run start:prod
```

---

## CI/CD Integration (GitHub Actions)

```yaml
# In GitHub Actions workflow:
- name: Install Doppler
  uses: dopplerhq/cli-action@v3

- name: Run tests with secrets
  run: doppler run --config staging -- npm test
  env:
    DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN }}
```

---

*Last updated: 2026-05-31 | Stream: STREAM-INFRA Phase 1.3*
