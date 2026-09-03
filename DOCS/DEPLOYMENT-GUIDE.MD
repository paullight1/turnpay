# TRUSTPAY Deployment Guide

How to deploy TRUSTPAY to production.

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Database Setup](#database-setup)
4. [Docker Deployment](#docker-deployment)
5. [Manual Deployment](#manual-deployment)
6. [Platform-Specific Guides](#platform-specific-guides)
7. [Post-Deployment](#post-deployment)
8. [Monitoring](#monitoring)
9. [Backup & Recovery](#backup--recovery)

---

## Prerequisites

- Domain name (e.g., `api.trustpayhq.com`, `www.trustpayhq.com`)
- SSL certificates (Let's Encrypt)
- PostgreSQL 16+ database
- Redis 7+ instance
- Node.js 22+ runtime (if not using Docker)

---

## Environment Setup

### Backend `.env` (Production)
```bash
# Server
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://trustpay:STRONG_PASSWORD@db-host:5432/trustpay_prod?schema=public

# Redis
REDIS_HOST=redis-host
REDIS_PORT=6379
REDIS_PASSWORD=STRONG_REDIS_PASSWORD

# JWT
JWT_SECRET=$(openssl rand -hex 64)
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=$(openssl rand -hex 64)
JWT_REFRESH_EXPIRES_IN=7d

# URLs
WEB_URL=https://app.trustpay.com
ADMIN_URL=https://admin.trustpay.com

# Single-source providers
BANKING_PROVIDER_PRIMARY=monnify
BANKING_PROVIDER_FALLBACK=
MONNIFY_BASE_URL=https://api.monnify.com
MONNIFY_API_KEY=
MONNIFY_SECRET_KEY=
MONNIFY_CONTRACT_CODE=
MONNIFY_WEBHOOK_URL=https://api.trustpayhq.com/api/webhooks/monnify

VTU_PROVIDER=vtpass
VTPASS_BASE_URL=https://vtpass.com/api
VTPASS_API_KEY=
VTPASS_PUBLIC_KEY=
VTPASS_SECRET_KEY=
VTPASS_WEBHOOK_SECRET=

KYC_PROVIDER=ninja
NINJA_BASE_URL=https://api.ninja.boucloud.io
NINJA_CLIENT_KEY=
NINJA_CLIENT_SECRET=

# FX Rate API
FX_RATE_API_URL=https://v6.exchangerate-api.com/v6/KEY/latest/GHS
FX_RATE_API_KEY=KEY

# Logging
LOG_LEVEL=info

# Optional
SENTRY_DSN=https://xxx@sentry.io/xxx
```

### Frontend `.env.production`
```bash
NEXT_PUBLIC_API_URL=https://api.trustpayhq.com
NEXT_PUBLIC_WEBSITE_URL=https://app.trustpay.com
```

---

## Database Setup

### 1. Create Database
```sql
CREATE DATABASE trustpay_prod;
CREATE USER trustpay WITH PASSWORD 'STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE trustpay_prod TO trustpay;
```

### 2. Run Migrations
```bash
cd backend
npx prisma migrate deploy
```

### 3. Generate Client
```bash
npx prisma generate
```

### 4. Seed Data (Optional)
```bash
npx ts-node prisma/seed.ts
```

---

## Docker Deployment

### Quick Start
```bash
# Clone repository
git clone https://github.com/your-org/trustpay.git
cd trustpay

# Create .env files
cp .env.example .env
# Edit .env with production values

# Build and start
docker-compose -f docker-compose.prod.yml up -d --build

# Check logs
docker-compose -f docker-compose.prod.yml logs -f
```

### Individual Services
```bash
# Backend only
docker build -t trustpay/backend ./backend
docker run -d --name trustpay-api -p 3000:3000 --env-file .env trustpay/backend

# Website only
docker build -t trustpay/website ./website
docker run -d --name trustpay-web -p 3001:3001 trustpay/website
```

---

## Manual Deployment

### Backend (PM2)
```bash
cd backend

# Install dependencies
npm ci --production

# Build
npm run build

# Start with PM2
pm2 start dist/main.js --name trustpay-api

# Save PM2 config
pm2 save
pm2 startup
```

### Website (PM2)
```bash
cd website

# Install dependencies
npm ci --production

# Build
npm run build

# Start with PM2
pm2 start node_modules/.bin/next --name trustpay-web -- start -p 3001

# Save PM2 config
pm2 save
```

---

## Platform-Specific Guides

### AWS (ECS)
```yaml
# Task Definition
{
  "family": "trustpay-api",
  "containerDefinitions": [{
    "name": "trustpay-api",
    "image": "your-ecr/trustpay/backend:latest",
    "portMappings": [{"containerPort": 3000}],
    "environment": [...],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/trustpay",
        "awslogs-region": "us-east-1"
      }
    }
  }]
}
```

### DigitalOcean App Platform
```yaml
# .do/app.yaml
name: trustpay
services:
  - name: api
    github:
      repo: your-org/trustpay
      branch: main
    dockerfile_path: backend/Dockerfile
    instance_size_slug: basic-xxs
    envs:
      - key: NODE_ENV
        value: production
```

### Vercel (Frontend)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
cd website
vercel --prod
```

### Render
```yaml
# render.yaml
services:
  - type: web
    name: trustpay-api
    env: node
    buildCommand: cd backend && npm ci && npm run build
    startCommand: cd backend && node dist/main.js
    envVars:
      - key: NODE_ENV
        value: production
```

---

## Post-Deployment

### 1. Verify Health
```bash
curl https://api.trustpayhq.com/api/health
# Expected: {"status":"ok","checks":{"database":"connected","redis":"connected"}}
```

### 2. Run Migrations
```bash
cd backend
npx prisma migrate deploy
```

### 3. Verify Swagger Docs
```
https://api.trustpayhq.com/api/docs
```

### 4. Test Webhooks
- Configure Monnify: `https://api.trustpayhq.com/api/webhooks/monnify`
- Configure VTpass: `https://api.trustpayhq.com/api/webhooks/vtu/vtpass`
- Ninja direct BVN/NIN verification does not require a webhook URL.
- Verify signatures and duplicate-event idempotency for all three providers

### 5. Create Admin User
```typescript
// Run in backend
npx ts-node prisma/create-admin.ts
```

---

## Monitoring

### Health Checks
| Endpoint | Frequency | Alert |
|----------|-----------|-------|
| `/api/health` | Every 30s | 2 consecutive failures |
| Database ping | Every 30s | 1 failure |
| Redis ping | Every 30s | 1 failure |

### Logging
- All logs in JSON format (Pino)
- Centralized via ELK stack or Datadog
- Retention: 90 days

### Alerts
| Metric | Threshold | Action |
|--------|-----------|--------|
| CPU | > 80% for 5 min | Scale up |
| Memory | > 85% | Scale up |
| Error rate | > 1% | Page on-call |
| Response time | > 2s p95 | Investigate |
| Failed transactions | > 0 in 5 min | Alert |

---

## Backup & Recovery

### Database Backup
```bash
# Daily backup (cron)
0 2 * * * pg_dump -h db-host -U trustpay trustpay_prod | gzip > /backups/db-$(date +\%Y\%m\%d).sql.gz

# Restore
gunzip -c db-20240101.sql.gz | psql -h db-host -U trustpay trustpay_prod
```

### Redis Backup
```bash
# Enable AOF in redis.conf
appendonly yes
appendfsync everysec

# Backup RDB file
cp /var/lib/redis/dump.rdb /backups/redis-$(date +%Y%m%d).rdb
```

### Recovery Steps
1. Stop application
2. Restore database from latest backup
3. Verify data integrity
4. Restart application
5. Verify health endpoint

---

## SSL/TLS

### Let's Encrypt (Nginx)
```nginx
server {
    listen 443 ssl http2;
    server_name api.trustpayhq.com;

    ssl_certificate /etc/letsencrypt/live/api.trustpayhq.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.trustpayhq.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Scaling

### Horizontal Scaling
```bash
# Backend (PM2 cluster mode)
pm2 start dist/main.js -i max --name trustpay-api

# Docker Swarm
docker service scale trustpay-api=3
```

### Database Connection Pooling
```typescript
// Prisma connection URL with pool
DATABASE_URL=postgresql://user:pass@host:5432/db?schema=public&connection_limit=20&pool_timeout=10
```

### Redis Cluster
```typescript
// Redis cluster configuration
REDIS_HOST=redis-cluster-host
REDIS_PORT=6379
```
