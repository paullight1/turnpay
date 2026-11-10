> Historical guide. Superseded for current deployment/provider decisions. Use [the current operations index](00-README.MD), [Paystack activation](../PAYSTACK-ACTIVATION.md), and [the migration runbook](20-MIGRATION-RUNBOOK.md). Customer OTP is Supabase email; Sentry is optional; Monnify is legacy-only; the recorded active backend host is Dokploy. Do not apply the old SMS/provider/platform setup below to production.

# 🏗️ Production Provisioning Guide — PostgreSQL, Redis & App Hosting

> **Guide ID:** `PROD-16-PROVISION`
> **Stream:** STREAM-INFRA Phase 1.1 & 1.2
> **Target Platform:** DigitalOcean (Lagos region — `lag`)
> **Last Updated:** 2026-05-31

---

## Provider Decision: DigitalOcean

### Why DigitalOcean for TRUSTPAY

| Factor | DigitalOcean | Render | Fly.io | Railway | AWS RDS |
|---|---|---|---|---|---|
| **African Region** | **Lagos (LAG)** — 15ms | None (Frankfurt, 350ms) | Johannesburg, 250ms | None | Cape Town, 250ms |
| **PostgreSQL** | Managed, $15/mo (1GB) | Managed, $7/mo (256MB) | Managed, ~$17/mo | Managed, $5/mo | RDS, ~$15/mo |
| **Redis** | Managed, $15/mo (1GB) | Managed, $10/mo | Manual sidecar | Not managed | ElastiCache |
| **App Hosting** | App Platform, ~$10/mo | Web Service, $7/mo | Machines, ~$8/mo | Service, $5/mo | ECS, ~$80/mo |
| **pgBouncer** | Built-in (port 25060) | Built-in | Manual | None | RDS Proxy ($) |
| **PITR** | Yes | $200/mo tier only | Yes | No | Yes |
| **Setup Time** | ~10 min | ~2 min | ~15 min | ~2 min | ~30+ min |
| **VPC** | Included | Private Service | WireGuard | None | VPC required |

**Verdict:** DigitalOcean is the **only provider with a Lagos datacenter** — sub-15ms latency for Nigerian users vs 250-350ms for all alternatives. Combined with built-in pgBouncer, PITR, unified billing for PG+Redis+App, and $40-52/mo total, it's the clear winner for a West African fintech.

---

## 1. Managed PostgreSQL Provisioning

### Prerequisites

```bash
# Install doctl CLI
brew install doctl

# Create API token at https://cloud.digitalocean.com/account/api/tokens
# Required scopes: read + write
doctl auth init --access-token YOUR_DO_API_TOKEN
doctl account get  # verify
```

### Step 1: Create VPC Network

All resources communicate over private network — no public database exposure.

```bash
doctl vpcs create \
  --name trustpay-vpc \
  --region lag \
  --ip-range "10.100.0.0/16"
```

### Step 2: Provision PostgreSQL 16

**Via Dashboard:**
1. Databases → PostgreSQL → Create Database Cluster
2. Engine: **PostgreSQL 16**
3. Plan: **Basic — 1 GB RAM, 10 GB SSD ($15/mo)**
4. Region: **Lagos (LAG)**
5. VPC: **trustpay-vpc**
6. Database name: `trustpay_db`
7. Generate password: `openssl rand -base64 48 | tr -d '/+' | head -c 64`

**Via CLI:**
```bash
doctl databases create \
  --engine pg \
  --version 16 \
  --region lag \
  --size db-s-1vcpu-1gb \
  --num-nodes 1 \
  --storage-size-mib 10240 \
  --private-network-uuid YOUR_VPC_UUID \
  trustpay-postgres-db
```

### Step 3: Configure Connection Pooling

DigitalOcean provides built-in pgBouncer. Use the **Connection Pool** endpoint:

- **Pool port:** `25060`
- **Pool mode:** `transaction`
- **Pool size:** `20` (default)

```
DATABASE_URL=postgresql://trustpay:YOUR_PASSWORD@trustpay-postgres-db-do-user-XXXX-0.db.ondigitalocean.com:25060/trustpay_db?sslmode=require&schema=public
```

### Step 4: SSL/TLS & Security

- SSL enforced by default — verify `sslmode=require` in connection string
- Trusted Sources: restrict to VPC CIDR (`10.100.0.0/16`) only
- Download CA cert from Settings → Security for local verification

### Step 5: Backups & PITR

- Daily backups: enabled by default; the selected plan and the encrypted
  `BACKEND/scripts/backup-db.sh` job must provide at least 30-day retention
- Point-in-Time Recovery: enabled
- Verify: `doctl databases backup-list YOUR_DATABASE_ID`

### Step 6: Maintenance Window

```bash
doctl databases update YOUR_DATABASE_ID \
  --maintenance-window "sunday=02:00"
```

---

## 2. Managed Redis Provisioning

### Step 1: Provision Redis 7

**Via Dashboard:**
1. Databases → Redis → Create Database Cluster
2. Plan: **Basic — 1 GB RAM ($15/mo)**
3. Region: **Lagos (LAG)**
4. VPC: **trustpay-vpc**
5. Auth token: `openssl rand -base64 32`

**Via CLI:**
```bash
doctl databases create \
  --engine redis \
  --version 7 \
  --region lag \
  --size db-s-1vcpu-1gb \
  --num-nodes 1 \
  --storage-size-mib 10240 \
  --private-network-uuid YOUR_VPC_UUID \
  trustpay-redis
```

### Step 2: Eviction Policy

```bash
doctl databases update YOUR_REDIS_ID --eviction-policy allkeys-lru
```

**Why `allkeys-lru`:** TRUSTPAY uses Redis for rate limiting, circuit breaker state, idempotency keys, session management, and general caching. LRU eviction ensures the cache never fills and blocks writes — old/least-used keys are evicted first.

### Step 3: TLS Connection

```
REDIS_URL=rediss://default:YOUR_AUTH_TOKEN@trustpay-redis-do-user-XXXX-0.db.ondigitalocean.com:25061
```

### Step 4: Verify

```bash
redis-cli -h trustpay-redis-do-user-XXXX-0.db.ondigitalocean.com \
  -p 25061 -a YOUR_TOKEN --tls PING
# Expected: PONG
```

---

## 3. DigitalOcean App Platform (Backend + Web)

### Deployment Config

The `do-app.yaml` at `BACKEND/do-app.yaml` defines both services:
- **trustpay-backend** — NestJS API (port 3000)
- **trustpay-website** — Next.js frontend (port 3001)

### Deploy

```bash
# From project root
doctl apps create --spec BACKEND/do-app.yaml

# Or via GitHub integration:
# 1. Connect GitHub repo in App Platform dashboard
# 2. Point to do-app.yaml
# 3. Auto-deploys on push to main

# Check status
doctl apps list
doctl apps get YOUR_APP_ID
```

---

## 4. Critical Production Env Vars

| Variable | Source | Format |
|---|---|---|
| `DATABASE_URL` | DO PostgreSQL pool | `postgresql://user:pass@host:25060/db?sslmode=require` |
| `REDIS_PASSWORD` | DO Redis auth token | 32-char base64 |
| `REDIS_HOST` | DO Redis hostname | `trustpay-redis-...db.ondigitalocean.com` |
| `REDIS_PORT` | DO Redis TLS port | `25061` |
| `REDIS_URL` | DO Redis full URL | `rediss://default:TOKEN@HOST:25061` |
| `PII_ENCRYPTION_KEY` | Generated | `openssl rand -hex 32` |
| `BANK_ACCOUNT_ENCRYPTION_KEY` | Generated | `openssl rand -hex 32` |
| `JWT_SECRET` | Generated | `openssl rand -base64 32` |
| `JWT_REFRESH_SECRET` | Generated | `openssl rand -base64 32` |

---

## 5. Verification Checklist

### PostgreSQL
- [ ] SSL connection verified (`sslmode=require`)
- [ ] PostgreSQL 16 running
- [ ] pgBouncer active (port 25060)
- [ ] Daily backups confirmed
- [ ] PITR enabled
- [ ] Maintenance window set (Sunday 02:00)
- [ ] Trusted Sources restricted to VPC only
- [ ] `npx prisma migrate deploy` succeeds
- [ ] `npx prisma generate` succeeds

### Redis
- [ ] TLS ping succeeds (`PONG`)
- [ ] Eviction policy = `allkeys-lru`
- [ ] AUTH token set
- [ ] Only VPC clients allowed
- [ ] ioredis health check passes (`GET /api/health`)
- [ ] Rate limiting functional
- [ ] Idempotency key storage works

### End-to-End
- [ ] Backend starts and connects to DO PG + Redis
- [ ] `GET /api/health` returns 200 with both DB and Redis connected
- [ ] Rate limiting blocks after threshold
- [ ] Idempotency prevents duplicate transactions
- [ ] Cache hit/miss working correctly
- [ ] Transaction flow executes without errors

---

## 6. Monthly Cost Estimate

| Resource | Spec | Cost |
|---|---|---|
| DO Managed PostgreSQL | 1 GB RAM, 10 GB SSD | $15/mo |
| DO Managed Redis | 1 GB RAM | $15/mo |
| DO App Platform (backend) | Basic XXS (512MB) | $5/mo |
| DO App Platform (website) | Basic XXS (512MB) | $5/mo |
| **Total (startup)** | | **~$40/mo** |
| **Total (production HA)** | 2x backend + larger DB | **~$80-120/mo** |

---

## 7. Migration from Local Docker

```bash
# 1. Dump local dev database
docker exec trustpay-postgres pg_dump -U trustpay trustpay_db > local_dump.sql

# 2. Restore to DigitalOcean (via connection pool)
psql "postgresql://trustpay:PASS@host:25060/trustpay_db?sslmode=require" < local_dump.sql

# 3. Run Prisma migrations (idempotent — safe to run on existing schema)
cd BACKEND
DATABASE_URL="postgresql://trustpay:PASS@host:25060/trustpay_db?sslmode=require" \
  npx prisma migrate deploy

# 4. Generate Prisma client
npx prisma generate

# 5. Run seed (optional — for staging only)
DATABASE_URL="..." npx ts-node prisma/seed.ts

# 6. Verify row counts match
psql "DO_POOL_URL" -c "
  SELECT 'users' AS tbl, COUNT(*) FROM \"User\" UNION ALL
  SELECT 'wallets', COUNT(*) FROM \"Wallet\" UNION ALL
  SELECT 'transactions', COUNT(*) FROM \"Transaction\";
"

# 7. Delete local dump after verification (contains PII!)
rm local_dump.sql
```

---

## Appendix: Quick-Start Provisioning Script

```bash
#!/usr/bin/env bash
# scripts/provision-do.sh — TRUSTPAY DigitalOcean infrastructure
set -euo pipefail

TOKEN="${1:?Usage: $0 <DO_API_TOKEN>}"
REGION="lag"
VPC_NAME="trustpay-vpc"
PG_NAME="trustpay-postgres-db"
REDIS_NAME="trustpay-redis"

doctl auth init --access-token "$TOKEN"

echo "=== Creating VPC in $REGION ==="
VPC_UUID=$(doctl vpcs create --name "$VPC_NAME" --region "$REGION" \
  --ip-range "10.100.0.0/16" --format ID --no-header)
echo "VPC: $VPC_UUID"

echo "=== Creating PostgreSQL 16 ==="
PG_ID=$(doctl databases create --engine pg --version 16 --region "$REGION" \
  --size db-s-1vcpu-1gb --num-nodes 1 --storage-size-mib 10240 \
  --private-network-uuid "$VPC_UUID" --format ID --no-header "$PG_NAME")
echo "PostgreSQL ID: $PG_ID"

echo "=== Creating Redis 7 ==="
REDIS_ID=$(doctl databases create --engine redis --version 7 --region "$REGION" \
  --size db-s-1vcpu-1gb --num-nodes 1 --storage-size-mib 10240 \
  --private-network-uuid "$VPC_UUID" --format ID --no-header "$REDIS_NAME")
echo "Redis ID: $REDIS_ID"

echo "=== Setting Redis eviction policy ==="
doctl databases update "$REDIS_ID" --eviction-policy allkeys-lru

echo "=== Waiting for databases to be ready ==="
echo "PostgreSQL URI:"
doctl databases connection "$PG_ID" --format URI --no-header
echo "Redis URI:"
doctl databases connection "$REDIS_ID" --format URI --no-header

echo "=== Done! ==="
echo "Next steps:"
echo "1. Set all secrets in secret manager (see DOCS/PRODUCTION-GUIDES/17-SECRET-INVENTORY.md)"
echo "2. Deploy backend: doctl apps create --spec BACKEND/do-app.yaml"
echo "3. Run migrations: npx prisma migrate deploy"
```

---

*Last updated: 2026-05-31 | Stream: STREAM-INFRA Phase 1.1–1.2*
