# Phase 1: Production Environment Provisioning -- Research, Planning & Recommendations

**Date:** 2026-05-31  
**Stream:** STREAM-INFRA  
**Status:** Research Complete (No provisioning executed)  
**Cost Estimate:** ~$120-$170/month total

---

## Task 1.1 -- Managed PostgreSQL

### Options Comparison

| Feature | AWS RDS (PostgreSQL) | DigitalOcean Managed DB | Render PostgreSQL | Fly.io Postgres |
|---|---|---|---|---|
| **Starter Pricing** | ~$17/mo (db.t3.micro, 1 vCPU, 1GB RAM) | ~$15/mo (1 vCPU, 1GB RAM, 10GB storage) | ~$7/mo (256MB RAM, 1GB disk -- too small) | ~$17/mo (shared CPU, 1GB RAM, 10GB disk) |
| **Min Spec for Fintech** | db.t3.medium (2 vCPU, 4GB) ~$52/mo | 2 vCPU, 4GB RAM ~$60/mo | Pro plan 2GB RAM ~$25/mo too small | Dedicated 2 vCPU, 4GB ~$45/mo |
| **SSL/TLS** | Enforced by default | Enforced by default | Enforced | Enforced |
| **Auto Backup** | Daily, 7-35 day retention | Daily, 7 day retention | Daily, 7 day retention | Daily (limited) |
| **PITR (Point-in-Time Recovery)** | Yes (configurable, 35 days) | Yes (7 days included) | No on starter plans | Yes (limited) |
| **Connection Pooling** | RDS Proxy (separate cost ~$15/mo) or PgBouncer on EC2 | Built-in PgBouncer included | Built-in connection pooling | Built-in PgBouncer |
| **Multi-AZ HA** | Yes (separate cost) | Yes (additional cost) | No on basic plans | Built-in with failover |
| **VPC/Network Isolation** | Full VPC | VPC on premium | No | WireGuard tunnel |
| **Managed Upgrades** | Manual | Automatic minor | Automatic | Requires restart |

### Recommendation: DigitalOcean Managed PostgreSQL (2 vCPU, 4GB RAM, 30GB disk)

**Rationale:**
1. **Built-in PgBouncer** is included at no extra cost -- the app's production config demands connection pooling. AWS RDS requires RDS Proxy at $15/mo extra or self-managing PgBouncer.
2. **PITR (7-day)** is included. The app needs automated daily backups with PITR as a fintech application.
3. **VPC/private networking** isolates the DB from the public internet, critical for fintech PCI-like considerations.
4. **Simple scaling** -- vertical CPU/RAM upgrades without downtime.
5. **Cost-effective** at ~$60/mo for the minimum fintech-viable spec. RDS comparable tier with PgBouncer would cost ~$67+/mo.
6. **Automatic minor version upgrades** with predictable maintenance windows.

**If budget is extremely tight (MVP only):** Render PostgreSQL Pro at $25/mo (2GB RAM) but omits PITR and has lower RAM for DB cache.

### Minimum Spec for Fintech App (Staging + Production)

| | Staging | Production |
|---|---|---|
| **vCPU** | 1 (shared) | 2 (dedicated) |
| **RAM** | 2 GB | 4 GB |
| **Storage** | 10 GB | 30 GB (with room for growth) |
| **Backups** | Daily, 7-day retention | Daily, PITR 7-day |
| **Connection Pooling** | PgBouncer (built-in) | PgBouncer (built-in) |

### Connection String Format

```
# Standard format (no SSL mode):
postgresql://user:password@host:5432/database_name?schema=public

# With SSL required (production):
postgresql://user:password@host:5432/database_name?sslmode=require&schema=public

# With connection pooling via built-in PgBouncer (DigitalOcean appends ?sslmode=require):
postgresql://trustpay:password@db-postgresql-nyc1-xxxxx.do.db.ondigitalocean.com:25060/trustpay_production?sslmode=require&schema=public
```

The app uses `schema=public` (default). The DATABASE_URL is consumed by Prisma at `prisma/schema.prisma` line 7: `url = env("DATABASE_URL")`.

### Next Steps
1. Create DigitalOcean account and project
2. Provision staging DB: 1 vCPU / 2GB RAM / 10GB storage / daily backups
3. Provision production DB: 2 vCPU / 4GB RAM / 30GB storage / PITR enabled
4. Set `sslmode=require` on both
5. Configure firewall to allow only the backend's IP/network
6. Record connection strings for injection into secret manager
7. Run `npx prisma migrate deploy` to apply schema

---

## Task 1.2 -- Managed Redis

### Options Comparison

| Feature | AWS ElastiCache | DigitalOcean Managed Redis | Upstash | Render Redis |
|---|---|---|---|---|
| **Starter Pricing** | ~$17/mo (cache.t3.micro, 0.5GB) | ~$15/mo (1 GB) | Free tier (256MB, 5000 req/day) then ~$7/mo | ~$7/mo (256MB) |
| **TLS Encryption** | Yes | Yes | Yes | Yes |
| **Auth Token** | Yes (AUTH token) | Yes (password) | Yes (token-based) | Yes (password) |
| **Private Network/VPC** | Full VPC | VPC on premium | Global network | No (public endpoint with TLS) |
| **maxmemory-policy** | Configurable (default volatile-lru) | Configurable (set allkeys-lru) | Configurable (set allkeys-lru) | Configurable |
| **Min Memory (viable)** | 0.5 GB | 1 GB | 0.25 GB | 0.25 GB |
| **Persistence** | AOF/RDB configurable | AOF enabled | AOF on paid plans | Enabled |
| **Managed Upgrades** | Auto minor | Auto minor | Fully managed | Auto |

### Recommendation: DigitalOcean Managed Redis (1 GB)

**Rationale:**
1. **1 GB baseline** aligns with the project's requirement (minimum 1 GB) and is sufficient for rate alerts, OTP codes, idempotency keys, and session caching.
2. **Private network** with VPC on DigitalOcean keeps Redis traffic off the public internet, critical for a fintech app to avoid MITM on cache data.
3. **Built-in TLS + auth password** -- the app's `RedisService` uses `REDIS_PASSWORD` for auth and TLS can be enforced at the managed service level.
4. **Cost-effective** at ~$15/mo for 1 GB. ElastiCache at similar tier starts at ~$17/mo but adds complexity of VPC setup.
5. **Same provider as PostgreSQL** -- simpler network topology on a single DigitalOcean VPC.

**Upstash** is compelling for its free tier and global distribution, but the app uses Redis for idempotency locking (NX keys), rate limiting, and local caching which benefits from co-location with the backend. Upstash's global network adds latency for these use cases.

### Connection Details

```
# Direct connection (local dev):
redis://:password@localhost:6379

# Production (DigitalOcean with TLS):
rediss://:password@db-redis-nyc1-xxxxx.db.ondigitalocean.com:25061

# The app uses host/port/password separately via ConfigService:
REDIS_HOST=db-redis-nyc1-xxxxx.db.ondigitalocean.com
REDIS_PORT=25061
REDIS_PASSWORD=<auth_token>

# Or as a single REDIS_URL for convenience:
REDIS_URL=rediss://:<password>@<host>:25061
```

**Note:** The app currently uses separate REDIS_HOST, REDIS_PORT, REDIS_PASSWORD config (see `redis/redis.service.ts`). A REDIS_URL env var is not consumed by the code but could be added for convenience. The current approach is fine.

### maxmemory-policy Configuration

For the app's use cases:
- `allkeys-lru` -- evicts least-recently-used keys regardless of expiry. Best for cache use of OTP, rate limits, idempotency keys, and session data. This is what the spec requires.

### Next Steps
1. Provision DigitalOcean Managed Redis (1 GB) in the same VPC as PostgreSQL
2. Enable TLS enforcement and generate auth token
3. Set `maxmemory-policy=allkeys-lru`
4. Whitelist backend IP ranges
5. Record REDIS_HOST, REDIS_PORT, REDIS_PASSWORD for secret manager

---

## Task 1.3 -- Secret Manager

### Options Comparison

| Feature | Doppler | Infisical (Cloud) | AWS Secrets Manager | Render/Fly.io Env Vars |
|---|---|---|---|---|
| **Pricing** | Free: 5 projects, 3 users; $5/mo/project for teams | Free: unlimited projects, 5 members; Team $20/mo | ~$0.40/secret/month + $0.05/10k API calls | Free (included in hosting cost) |
| **Secret Inventory** | Dashboard, CLI, integrations | Dashboard, CLI, SDK | Console, CLI, SDK | Manual (env vars UI) |
| **Env Separation** | Native (prod/staging/dev) | Native (prod/staging/dev) | Each env separate | Built into service |
| **API/SDK for Injection** | `@dopplerhq/node-sdk`, env injection | `@infisical/sdk`, CLI | `aws-sdk` | natively injected in hosting |
| **Audit Trail** | Yes (free tier limited) | Yes (team plan) | Yes (CloudTrail) | No |
| **Secret Rotation** | Manual with hooks | Manual | Automated rotation (RDS) | Manual |
| **Self-Host Option** | No | Yes (self-host open source) | No | N/A |
| **CI/CD Integration** | `doppler run` | `infisical run` | AWS SDK in CI | Provider-native |

### Recommendation: Doppler

**Rationale:**
1. **Free tier is generous**: 5 projects (prod, staging, dev) supported at no cost for a small team.
2. **Native env separation** per project (development/staging/production) with easy pull via `doppler run` or the SDK.
3. **Full audit trail** for who accessed/modified each secret -- critical for fintech compliance.
4. **CLI tool** works perfectly in CI/CD pipelines: `doppler run --command="npm run start:prod"` injects the correct env's secrets.
5. **No VPC/latency concerns** compared to AWS Secrets Manager (which adds API call latency on boot).
6. **Simpler than Infisical** for a team of 1-3 developers -- less overhead.
7. **If needed later**, Render's native env vars or AWS SM can be adopted via the SDK without changing secret architecture.

**Why not others:**
- **Render native env vars** -- no audit trail, no env separation management, no rotation support. Fine for absolute MVP but risky for fintech.
- **AWS Secrets Manager** -- adds ~40ms latency per call on boot, complex IAM setup for a single-region app, and costs add up per secret.
- **Infisical** -- excellent tool but overkill for this stage. The self-host option is valuable for strict compliance but adds operational overhead.

### Full Secret Inventory

The following secrets were extracted by analyzing `BACKEND/.env`, `BACKEND/src/app.module.ts` (Joi validation schema), and `DOCS/KYC-GUIDE.MD`.

**Legend:** [B] = Both environments | [P] = Production-only | [S] = Staging-only | [F] = Feature flag (may toggle)

#### Category: Database & Core Config
| # | Secret Name | Env | Source | Notes |
|---|---|---|---|---|
| 1 | `DATABASE_URL` | [B] | .env | Different values per env. Production: full connection with sslmode=require. Staging: sandbox DB. |
| 2 | `NODE_ENV` | [B] | app.module.ts | `production` in prod, `staging` in staging |
| 3 | `PORT` | [B] | app.module.ts | Default 3000; likely same in both |
| 4 | `LOG_LEVEL` | [B] | main.ts (pino) | `info` in prod, `debug` in staging |

#### Category: Authentication & Encryption
| # | Secret Name | Env | Source | Notes |
|---|---|---|---|---|
| 5 | `JWT_SECRET` | [B] | app.module.ts | Production: 256-bit random. Staging can differ. |
| 6 | `JWT_REFRESH_SECRET` | [B] | app.module.ts | 256-bit random, separate from JWT_SECRET |
| 7 | `PII_ENCRYPTION_KEY` | [B] | app.module.ts, KYC-GUIDE | Min 32 chars (256-bit AES). Encrypts BVN/NIN at rest. |
| 8 | `PII_KEY_VERSION` | [B] | app.module.ts, KYC-GUIDE | `1` initially; incremented on key rotation |
| 9 | `BANK_ACCOUNT_ENCRYPTION_KEY` | [B] | app.module.ts | Min 32 chars. Encrypts bank account numbers. |

#### Category: Supabase (Auth + Storage)
| # | Secret Name | Env | Source | Notes |
|---|---|---|---|---|
| 10 | `SUPABASE_URL` | [B] | .env, KYC-GUIDE | Different Supabase projects per env or shared with bucket isolation |
| 11 | `SUPABASE_PUBLISHABLE_KEY` | [B] | .env, app.module.ts | Public, exposed in web client |
| 12 | `SUPABASE_ANON_KEY` | [B] | .env, app.module.ts | Public, used as fallback for publishable key |
| 13 | `SUPABASE_SERVICE_ROLE_KEY` | [B] | app.module.ts, KYC-GUIDE | **Highly sensitive.** Full admin access. Keep server-side only. |
| 14 | `SUPABASE_JWT_SECRET` | [P] | app.module.ts | Used for Supabase JWT validation |

#### Category: KYC & Document Storage
| # | Secret Name | Env | Source | Notes |
|---|---|---|---|---|
| 15 | `KYC_DOCUMENT_BUCKET` | [B] | KYC-GUIDE | `kyc-documents` (same name, different Supabase project per env) |
| 16 | `KYC_ADMIN_DOCUMENT_URL_TTL_SECONDS` | [B] | KYC-GUIDE | `300` (5 min) |
| 17 | `EXCHANGE_RECEIPT_BUCKET` | [B] | app.module.ts | `exchange-receipts` |
| 18 | `EXCHANGE_RECEIPT_PROOF_URL_TTL_SECONDS` | [B] | app.module.ts | `300` (5 min) |

#### Category: Redis
| # | Secret Name | Env | Source | Notes |
|---|---|---|---|---|
| 19 | `REDIS_HOST` | [B] | app.module.ts, redis/redis.service.ts | Different hostname per env |
| 20 | `REDIS_PORT` | [B] | app.module.ts | `25061` for managed (TLS), `6379` for local |
| 21 | `REDIS_PASSWORD` | [B] | app.module.ts, redis/redis.service.ts | Required in production (min 16 chars per schema) |

#### Category: Payments (Paystack)
| # | Secret Name | Env | Source | Notes |
|---|---|---|---|---|
| 22 | `PAYSTACK_SECRET_KEY` | [B] | .env, app.module.ts | Live key in prod; test key in staging |
| 23 | `PAYSTACK_PUBLIC_KEY` | [B] | app.module.ts | Public key, exposed in frontend |
| 24 | `PAYSTACK_WEBHOOK_URL` | [P] | app.module.ts | Production HTTPS webhook endpoint |
| 25 | `PAYSTACK_WEBHOOK_SECRET` | [B] | app.module.ts | HMAC SHA-512 verification |
| 26 | `PAYSTACK_DVA_PREFERRED_BANK` | [B] | app.module.ts | Bank code for DVA |

#### Category: Payments (Flutterwave)
| # | Secret Name | Env | Source | Notes |
|---|---|---|---|---|
| 27 | `FLUTTERWAVE_SECRET_KEY` | [B] | .env, app.module.ts | Live in prod, test in staging |
| 28 | `FLUTTERWAVE_PUBLIC_KEY` | [B] | app.module.ts | Public key |
| 29 | `FLUTTERWAVE_ENCRYPTION_KEY` | [B] | app.module.ts | 3DES encryption key for card payloads |
| 30 | `FLUTTERWAVE_SECRET_HASH` | [B] | app.module.ts | Webhook verification hash |

#### Category: Banking & Virtual Accounts (Monnify)
| # | Secret Name | Env | Source | Notes |
|---|---|---|---|---|
| 31 | `MONNIFY_API_KEY` | [B] | .env, app.module.ts | Live in prod, test in staging |
| 32 | `MONNIFY_SECRET_KEY` | [B] | .env, app.module.ts | Live in prod, test in staging |
| 33 | `MONNIFY_CONTRACT_CODE` | [B] | .env, app.module.ts | Contract ID per env |
| 34 | `MONNIFY_BASE_URL` | [B] | .env, app.module.ts | `https://sandbox.monnify.com` staging, `https://api.monnify.com` prod |
| 35 | `MONNIFY_WEBHOOK_SECRET` | [B] | app.module.ts | For validating `monnify-signature` |
| 36 | `MONNIFY_WEBHOOK_URL` | [P] | app.module.ts | Production HTTPS webhook URL |
| 37 | `MONNIFY_GET_ALL_AVAILABLE_BANKS` | [B] | app.module.ts | `true` |
| 38 | `MONNIFY_RESTRICT_PAYMENT_SOURCE` | [B] | app.module.ts | `false` |
| 39 | `MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER` | [B] | .env | Collection account for exchange flow |
| 40 | `MONNIFY_SANDBOX_TEST_KYC_BYPASS` | [S] | .env | Only staging |
| 41 | `MONNIFY_TEST_BVN` | [S] | .env | Only staging |
| 42 | `MONNIFY_TEST_NIN` | [S] | app.module.ts | Only staging |

#### Category: Banking Feature Flags
| # | Secret Name | Env | Source | Notes |
|---|---|---|---|---|
| 43 | `BANKING_ENABLED` | [B] | app.module.ts | `true` |
| 44 | `VIRTUAL_ACCOUNTS_ENABLED` | [B] | app.module.ts | `true` |
| 45 | `WITHDRAWALS_ENABLED` | [B] | app.module.ts | `true` when ready |
| 46 | `BANKING_PROVIDER_PRIMARY` | [B] | app.module.ts | `monnify` |
| 47 | `BANKING_PROVIDER_FALLBACK` | [B] | app.module.ts | Empty string |
| 48 | `SUPPORTED_BANKING_CURRENCIES` | [B] | app.module.ts | `NGN` |
| 49 | `BANKING_SANDBOX_MODE` | [S] | .env | `true` in staging, `false` in prod |
| 50 | `TRANSACTION_PIN_REQUIRED` | [B] | app.module.ts, KYC-GUIDE | `true` in production |

#### Category: VTU (VTPass)
| # | Secret Name | Env | Source | Notes |
|---|---|---|---|---|
| 51 | `VTU_PROVIDER` | [B] | .env | `vtpass` |
| 52 | `VTPASS_BASE_URL` | [B] | .env | `https://sandbox.vtpass.com/api` staging, live URL prod |
| 53 | `VTPASS_API_KEY` | [B] | .env | Live in prod, test in staging |
| 54 | `VTPASS_PUBLIC_KEY` | [B] | .env | Public key per env |
| 55 | `VTPASS_SECRET_KEY` | [B] | .env | Secret per env |
| 56 | `VTPASS_LOW_BALANCE_THRESHOLD` | [B] | .env | Threshold for balance alerts |

#### Category: VTU (Reloadly)
| # | Secret Name | Env | Source | Notes |
|---|---|---|---|---|
| 57 | `RELOADLY_ENABLED` | [F] | app.module.ts | Feature flag |
| 58 | `RELOADLY_CLIENT_ID` | [B] | app.module.ts | Sandbox/live credentials |
| 59 | `RELOADLY_CLIENT_SECRET` | [B] | app.module.ts | Sandbox/live credentials |
| 60 | `RELOADLY_WEBHOOK_SECRET` | [B] | app.module.ts | Webhook signature verification |
| 61 | `RELOADLY_WEBHOOK_URL` | [P] | app.module.ts | Production HTTPS webhook URL |
| 62 | `RELOADLY_AUTH_URL` | [B] | app.module.ts | `https://auth.reloadly.com/oauth/token` |
| 63 | `RELOADLY_TOPUPS_BASE_URL` | [B] | app.module.ts | `https://topups.reloadly.com` (prod) or sandbox |
| 64 | `RELOADLY_UTILITIES_BASE_URL` | [B] | app.module.ts | `https://utilities.reloadly.com` (prod) or sandbox |
| 65 | `RELOADLY_SENDER_COUNTRY_CODE` | [B] | app.module.ts | `NG` |

#### Category: OTP
| # | Secret Name | Env | Source | Notes |
|---|---|---|---|---|
| 66 | `OTP_EXPIRES_IN` | [B] | app.module.ts | e.g. `10m` |
| 67 | `OTP_LENGTH` | [B] | app.module.ts | `6` |
| 68 | `OTP_DEV_CODE` | [S] | app.module.ts | Dev bypass code (staging ONLY) |

#### Category: Monitoring & Observability
| # | Secret Name | Env | Source | Notes |
|---|---|---|---|---|
| 69 | `SENTRY_DSN` | [P] | main.ts | Sentry project DSN; staging uses a separate project or disabled |
| 70 | `ENABLE_SWAGGER` | [S] | main.ts | `true` in staging, omitted in prod to disable docs |

#### Category: CORS & URLs
| # | Secret Name | Env | Source | Notes |
|---|---|---|---|---|
| 71 | `WEB_URL` | [B] | app.module.ts | Production: `https://trustpay.io` (CORS allowlist). Staging: staging URL |
| 72 | `ADMIN_URL` | [B] | app.module.ts | Production: `https://admin.trustpay.io` or same subpath. Used for CORS. |

**Total: ~72 secrets/config values across both environments.**
- **Both environments:** ~55
- **Production-only:** ~10 (webhook URLs, Sentry DSN, live provider URLs, ENABLE_SWAGGER=false)
- **Staging-only:** ~7 (sandbox test bypasses, test BVN/NIN, OTP_DEV_CODE)

### Next Steps
1. Create Doppler account and workspace for the project
2. Create 3 projects: `trustpay-prod`, `trustpay-staging`, `trustpay-dev`
3. Populate all secrets above per environment
4. Generate production JWT_SECRET (256-bit): `openssl rand -base64 32`
5. Generate production JWT_REFRESH_SECRET (256-bit): `openssl rand -base64 32`
6. Generate production PII_ENCRYPTION_KEY (256-bit AES): `openssl enc -aes-256-cbc -k secret -P -md sha256 | grep key | cut -d= -f2 | xargs`
7. Generate production BANK_ACCOUNT_ENCRYPTION_KEY (256-bit): same method
8. Add `doppler run` to the backend's production start command in the deployment config
9. Verify zero secrets in committed code with `gitleaks detect` or `trufflehog`

---

## Task 1.4 -- Backend Deployment (Plan)

### Backend Build Process Summary

From `BACKEND/Dockerfile`:
1. **Stage 1 (builder):** `node:22-alpine`, `npm ci`, `npm run build` (NestJS compile)
2. **Stage 2 (production):** `node:22-alpine`, `apk add --no-cache dumb-init`, `npm ci --only=production`, copy `dist/` and `prisma/` from builder, `npx prisma generate`, expose port 3000, CMD `dumb-init node dist/main`

From `BACKEND/package.json`:
- Build: `nest build` (TypeScript compilation)
- Start prod: `node dist/main`
- Scripts: `db:deploy` (`npx prisma migrate deploy`), `db:generate` (`npx prisma generate`)
- Health check: `GET /api/health` (checks DB + Redis connectivity)

### Hosting Options Comparison

| Feature | Render (Web Service) | Fly.io | Railway | AWS ECS (Fargate) |
|---|---|---|---|---|
| **Starter Pricing** | ~$7/mo per service (512MB RAM, shared CPU) | ~$2.38/mo (shared VM, 256MB RAM) -- but more at scale | ~$5/mo (512MB RAM, shared CPU) | ~$10/mo (minimum: load balancer + Fargate) |
| **HTTPS** | Automatic + custom domain + cert | Automatic (anycast) | Automatic | Requires ALB (separate cost) |
| **Health Check** | Built-in, configurable path, interval, threshold | Configurable | Built-in | ALB target group health checks |
| **Horizontal Scaling** | Manual (add instances ~$7 each) | Auto-scaling (regions) | Manual | Full auto-scaling (ECS Service Auto Scaling) |
| **Docker Support** | Native (Dockerfile auto-detected) | Native (fly.toml) | Native (Dockerfile) | ECR + Task Definition |
| **Zero-Downtime Deploy** | Yes (blue-green) | Yes (rolling) | Yes | Yes (rolling + canary) |
| **Secret Injection** | Environment variables (Dashboard) | `fly secrets set` | Environment variables | AWS Secrets Manager / Parameter Store |
| **Logging** | Built-in dashboard + log stream | `fly logs` | Built-in | CloudWatch Logs (extra cost) |
| **Managed PostgreSQL** | Built-in add-on (easy) | Fly Postgres | Built-in plugin | RDS (separate) |
| **Managed Redis** | Built-in add-on | Upstash integration | Built-in plugin | ElastiCache (separate) |
| **CI/CD Integration** | GitHub auto-deploy | GitHub Actions | GitHub auto-deploy | GitHub Actions + ECR |

### Recommendation: Render (Web Service)

**Rationale:**
1. **Simplest path to production:** Dockerfile is already correct (`node:22-alpine`, multi-stage, health check exposed). Render auto-detects the Dockerfile.
2. **Health check built-in** at `/api/health` -- exactly what the backend exposes. Render monitors this and restarts on failure.
3. **Blue-green deploys** with zero downtime -- critical for a fintech app where every second of downtime can mean lost transactions.
4. **Automatic HTTPS + custom domain** with auto-renewing certs. No nginx/certbot setup.
5. **Secret injection** via Render Dashboard env vars. Combined with Doppler's `doppler run`, this gives double coverage.
6. **Managed PostgreSQL add-on** on the same platform simplifies initial setup, though we'll use DigitalOcean for cost/features.
7. **Logging dashboard** built-in with log streaming to external tools (Papertrail, etc.).
8. **Cost-effective** -- $7/mo per web service instance. Two instances for HA = $14/mo.

**Why not others:**
- **Fly.io** -- lower base cost but complex networking (WireGuard needed for private DB access), less mature for production fintech.
- **Railway** -- excellent DX but newer, fewer compliance/uptime SLAs than Render.
- **AWS ECS** -- overkill for launch. Adds significant complexity (IAM roles, VPC config, ALB setup, ECR push, CloudWatch costs). Reserve for when the app needs sophisticated auto-scaling at >1000 users.

### Deployment Architecture

```
                                  Internet
                                      |
                               Render HTTPS LB
                              /                  \
                    [Render Web Service 1]    [Render Web Service 2]
                    (node:22-alpine, :3000)   (node:22-alpine, :3000)
                              |                      |
                    +---------+---------+------------+
                    |                   |            |
              DigitalOcean         DigitalOcean   Supabase
              Managed PG           Managed Redis  (Auth + Storage)
              (PgBouncer)          (1GB RAM)
```

### Per-Instance Spec (Render)

| Resource | Value |
|---|---|
| **Instance Type** | Starter (shared CPU, 512MB RAM) |
| **Disk** | 1 GB (ephemeral -- DB is external) |
| **Count** | 2 (HA) |
| **Health Check Path** | `/api/health` |
| **Health Check Interval** | 5 seconds |
| **Health Check Timeout** | 10 seconds |
| **Health Check Success Threshold** | 1 |
| **Health Check Failure Threshold** | 3 (15s unhealthy → restart) |
| **Start Command** | `doppler run -- node dist/main` |
| **Deploy Hook** | GitHub push to main (auto-deploy) |

### Health Check Flow

1. Render's load balancer sends `GET /api/health` every 5 seconds
2. NestJS `HealthController` checks:
   - Database: `SELECT 1` via Prisma
   - Redis: `PING` via ioredis
3. Response: `{ status: "ok"|"degraded", checks: { database: "connected", redis: "connected" }, timestamp: "..." }`
4. If any check fails: HTTP 503 with degraded response body
5. After 3 consecutive failures: Render restarts the container
6. On restart: container reconnects all services, health check passes, traffic resumes

### Secret Injection Strategy

1. **Primary:** All secrets stored in Doppler
2. **Deployment:** Render environment has a single secret: `DOPPLER_TOKEN` (service token)
3. **Runtime:** Start command is `doppler run -- node dist/main` which injects all Doppler secrets as env vars
4. **Fallback:** Render Dashboard env vars set for the critical few (DATABASE_URL, DOPPLER_TOKEN) as redundancy

**Note:** Render's native env vars or Fly.io's `fly secrets set` work fine as a simpler alternative if Doppler is not adopted. The start command would then be `node dist/main` directly.

### Next Steps
1. Create Render account (or finalize DigitalOcean App Platform)
2. Connect GitHub repository
3. Create Web Service from Dockerfile
4. Configure 2 instances, health check `/api/health`
5. Set `NODE_ENV=production`
6. Inject secrets (via Doppler or Render env vars)
7. Set custom domain with auto-cert
8. Verify: `curl https://api.trustpay.io/api/health` returns 200

---

## Task 1.5 -- Web/Admin Deployment (Plan)

### Website Build Process Summary

From `WEBSITE/package.json`:
- Build: `next build`
- Dependencies: Next.js 16, Tailwind CSS v4, Radix UI, Supabase SSR, TanStack Query, Zod, Axios
- Tests: Playwright e2e (`playwright test`)

From `WEBSITE/next.config.ts`:
- Images: Unsplash remote pattern
- Turbopack enabled
- Security headers: HSTS (max-age=63072000), CSP, X-Frame-Options=DENY, X-Content-Type-Options=nosniff
- HSTS already set to 2 years with preload -- excellent for production

### Environment Variables Identified (NEXT_PUBLIC_ prefix)

| Variable | Source File | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | config.ts, api.ts, proxy.ts | Backend API base URL |
| `NEXT_PUBLIC_SUPABASE_URL` | supabase.ts, supabase-server.ts, proxy.ts | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | supabase.ts, supabase-server.ts, proxy.ts | Supabase public anon key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | supabase.ts, supabase-server.ts, proxy.ts | Fallback for publishable key |
| `NEXT_PUBLIC_MANUAL_EXCHANGE_BANK_NAME` | config.ts | Display: exchange bank details |
| `NEXT_PUBLIC_MANUAL_EXCHANGE_ACCOUNT_NAME` | config.ts | Display: exchange account name |
| `NEXT_PUBLIC_MANUAL_EXCHANGE_ACCOUNT_NUMBER` | config.ts | Display: exchange account number |

### Vercel vs Same-Platform-as-Backend

| Factor | Vercel | Render Static Site | Render Web Service |
|---|---|---|---|
| **Build Time** | 1-3 min | 3-5 min | 3-5 min |
| **CDN** | Global edge (100+ locations) | Global CDN | Limited |
| **Preview Deployments** | Native (every branch) | No | No |
| **Analytics** | Built-in | No | No |
| **ISR/SSR** | Native | Static only | Custom server |
| **Env Variables** | Dashboard + `.env.production` | Dashboard | Dashboard |
| **Custom Domain + HTTPS** | Auto | Auto | Auto |
| **Pricing** | Free (for this scale) | Included in Render plan | $7/mo extra service |
| **Cron/Edge Functions** | Yes | No | No |

### Recommendation: Vercel

**Rationale:**
1. **Free tier** easily handles a Next.js site of this size (27 routes, SSR pages, no e-commerce scale).
2. **Native Next.js support** -- Vercel is built by the Next.js team. ISR, SSR, and static generation work optimally.
3. **Preview deployments** per branch -- critical for testing admin changes and KYC flow updates before merge.
4. **Global CDN** serves static assets and SSR pages from edge locations worldwide.
5. **Automatic HTTPS + custom domain** with Vercel-managed certificates.
6. **Environment variables scoped by environment** (production/preview/development).
7. **No additional cost** vs. $7/mo minimum on Render for a second service.

**What about Vercel vs Render for the website?** Render Static Sites work but lack the SSR/ISR optimizations that Vercel provides natively. Since the app uses `@supabase/ssr` (server-side auth), SSR is needed for protected routes. Vercel handles this seamlessly.

### NEXT_PUBLIC_API_URL Configuration

```
# Production (Vercel)
NEXT_PUBLIC_API_URL=https://api.trustpay.io
NEXT_PUBLIC_SUPABASE_URL=https://gkpueopmdlqlfbvrzuqh.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<value>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<value>
NEXT_PUBLIC_MANUAL_EXCHANGE_BANK_NAME=TrustPay Settlement
NEXT_PUBLIC_MANUAL_EXCHANGE_ACCOUNT_NAME=TrustPay Ltd
NEXT_PUBLIC_MANUAL_EXCHANGE_ACCOUNT_NUMBER=<account_number>
```

The config.ts `resolveApiUrl()` function enforces HTTPS in production:
- If `NEXT_PUBLIC_API_URL` is set and production: must start with `https://` unless on localhost
- If unset in production: throws error
- In development: defaults to `http://localhost:3000`

### Admin Route Protection

From `WEBSITE/src/proxy.ts` (middleware):
1. Matcher: `/dashboard/:path*`, `/admin/:path*`, `/login`, `/register`
2. Protected routes (`/dashboard/*`, `/admin/*`) redirect to `/login` if no session
3. Admin routes (`/admin/*`) check session but **do not** enforce admin role client-side (the backend enforces it)
4. Auth routes (`/login`, `/register`) redirect to `/dashboard` if already logged in

### Build Command

```bash
# Vercel auto-detects Next.js and runs:
npm run build  # = next build

# This generates:
# - .next/ (static + server bundles)
# - Static export for SSG pages
# - Lambda functions for SSR pages (dashboard, admin)
```

### Next Steps
1. Push website code to GitHub (if not already)
2. Connect GitHub repo to Vercel
3. Configure production environment variables in Vercel dashboard
4. Set `NEXT_PUBLIC_API_URL` to production backend URL (e.g. `https://api.trustpay.io`)
5. Set custom domain (e.g. `trustpay.io`)
6. Configure preview deployments for PR branches
7. Run a smoke test of all 27 routes:
   - Public: `/`, `/features`, `/security`, `/support`, `/company`, `/vtu`, `/exchange`
   - Auth: `/login`, `/register`, `/forgot-password`, `/reset-password`
   - Protected: `/dashboard`, `/dashboard/exchange`, `/dashboard/fund`, `/dashboard/withdraw`, `/dashboard/wallet/[currency]`, `/dashboard/transactions`, `/dashboard/transactions/[id]`, `/dashboard/vtu`, `/dashboard/kyc`, `/dashboard/profile`, `/dashboard/support`
   - Admin: `/admin`, `/admin/kyc`, `/admin/support`, `/admin/vtu`
8. Verify HSTS headers: `curl -I https://trustpay.io | grep strict-transport`

---

## Task 1.6 -- Database Migration Plan

### Migration Infrastructure

From `BACKEND/package.json`:
```json
"db:migrate": "npx prisma migrate dev",              // Development: creates migration files
"db:deploy": "npx prisma migrate deploy",             // Production/staging: applies pending migrations
"db:generate": "npx prisma generate",                 // Generates Prisma client
"db:status": "npx prisma migrate status",             // Shows migration state
```

From `BACKEND/Dockerfile`:
```dockerfile
RUN npx prisma generate   # Line 23: generates client in production image
```

From `BACKEND/prisma.config.ts`:
```typescript
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
});
```

Migrations directory: `BACKEND/prisma/migrations/`

### Migration Command Sequence

#### Step 1: Staging Migration

```bash
# Set environment (via Doppler or direct env var export)
export DOPPLER_PROJECT=trustpay-staging

# Check pending migrations first (read-only)
npx prisma migrate status

# Apply all pending migrations
npx prisma migrate deploy

# Verify schema
npx prisma validate
```

**Expected output:**
```
Applied migration: 001_init
Applied migration: 002_wallet_ledger
Applied migration: 003_exchange_flow
...
Applied migration: 010_vtu_pricing
Applied migration: 011_kyc_tier_foundation

> All migrations have been successfully applied.
```

#### Step 2: Verify Staging

Connect to staging database and verify:
```sql
-- Check all tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Check foreign keys
SELECT
    tc.table_schema, tc.table_name, kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY';

-- Run Prisma-specific verify
npx prisma validate
npx prisma migrate status   # Should say "Database schema is up to date"
```

#### Step 3: Production Migration

```bash
# Set environment to production
export DOPPLER_PROJECT=trustpay-prod

# 1. Check migration state (read-only)
npx prisma migrate status

# 2. Take a backup first (or rely on provider's automated daily + PITR)
#    For DigitalOcean: Use the dashboard backup immediately before migration

# 3. Apply migrations
npx prisma migrate deploy

# 4. Generate the Prisma client (if not in Docker build)
npx prisma generate
```

#### Step 4: Verify Production

Same verification as staging:
```bash
npx prisma validate
npx prisma migrate status
```

Then test a connection from the backend process:
```bash
# Start backend and hit health endpoint
node dist/main &
curl http://localhost:3000/api/health
# Expected: {"status":"ok","checks":{"database":"connected","redis":"connected"}}
```

### Prisma Client Generation in Deploy Pipeline

The Prisma client must be generated **AFTER** migrations and **BEFORE** the app starts, because:
- `@prisma/client` includes the generated query engine which targets the specific schema
- The database schema determines the TypeScript types available to the app

**Render deployment flow:**
```
1. Git push to main
2. Render detects Dockerfile
3. Docker build:
   Stage 1:
     - npm ci
     - nest build
   Stage 2:
     - npm ci --only=production
     - COPY dist/ prisma/ from stage 1
     - RUN npx prisma generate    ← Client generated at build time
4. Render starts container:
     - node dist/main             ← Client is already generated
```

**If using non-Docker deployment (e.g., Railway without Docker):**
```
1. npm ci
2. npx prisma generate            ← Client generated
3. npx prisma migrate deploy      ← Migrations applied
4. npm run build                  ← NestJS compiled
5. node dist/main                 ← App starts
```

### Zero-Drift Verification

To ensure staging and production schemas match:

```bash
# Run this in CI for every PR:
npx prisma migrate status        # Check for drift

# Compare shadow databases (advanced):
# Best practice: after staging migration, capture the schema diff:
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma \
  --to-url $DATABASE_URL_STAGING \
  --script > /tmp/diff.sql

# If diff.sql is empty or contains only indexes/constraints, staging is in sync
```

### Migration Rollback Plan (if migration fails)

```bash
# Prisma does NOT support native rollback.
# Recovery steps:

# 1. If using PITR (DigitalOcean):
#    - Restore database to <5 minutes before the migration timestamp
#    - This is the safest method for fintech

# 2. If manual rollback needed:
#    - Identify the last good migration name from prisma/migrations/
#    - npx prisma migrate resolve --rolled-back "bad_migration_name"
#    - This marks the migration as rolled back without actually reverting it
#    - Manually write a down-migration SQL file and execute it against the DB

# 3. Prevent migration failures:
#    - Always run staging migration first
#    - Wait 24 hours with staging working before running production
#    - Use prisma migrate deploy (not prisma migrate dev) in production
```

### Migration Safety Checklist

| Check | Command/Procedure |
|---|---|
| No pending migrations shown | `npx prisma migrate status` |
| Migration is marked `baseline` correctly | Check `_prisma_migrations` table |
| Tables use `@@map` names (snake_case) | e.g., `users`, `wallets`, `ledger_entries` |
| Foreign keys intact | Run FK query against `information_schema` |
| Prisma client generates without error | `npx prisma generate` |
| Health endpoint passes DB check | `curl /api/health` |
| No drift between staging and prod | Diff schema or compare _prisma_migrations |

---

## Estimated Monthly Cost Summary

| Service | Component | Monthly Cost |
|---|---|---|
| **PostgreSQL** (DigitalOcean) | 2 vCPU, 4GB RAM, 30GB, PITR | ~$60 |
| **Redis** (DigitalOcean) | 1 GB | ~$15 |
| **Secret Manager** (Doppler) | Free tier (3 users, 5 projects) | $0 |
| **Backend Hosting** (Render) | 2x Starter instances ($7 each) | ~$14 |
| **Web/Admin Hosting** (Vercel) | Pro or Free tier | $0-$20 |
| **Database: Staging** (DigitalOcean) | 1 vCPU, 2GB, 10GB | ~$20 |
| **Redis: Staging** (DigitalOcean) | 512 MB | ~$10 |
| **TOTAL** | **Production + Staging** | **~$120-$170/mo** |

This is a baseline estimate. Variable costs (bandwidth, API calls, storage) may add ~$20-30/mo.

---

## Complete Implementation Order

```
Phase 1 Execution Sequence:
1. [TASK 1.3] Create Doppler account → populate all secrets → generate encryption keys
2. [TASK 1.1] Provision DigitalOcean PostgreSQL (staging first, then production)
3. [TASK 1.2] Provision DigitalOcean Redis (staging first, then production)
4. [TASK 1.6] Run Prisma migrations against staging → verify → run against production
5. [TASK 1.4] Deploy backend to Render → connect to DB/Redis → verify health endpoint
6. [TASK 1.5] Deploy website to Vercel → set env vars → verify all routes
```

**Note:** Tasks 1.3 (secrets) should go first because every other task needs the database connection strings, Redis passwords, and encryption keys ready.
