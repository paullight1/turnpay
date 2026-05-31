# 🏗️ Stream 2: Core Infrastructure & Security — Production Foundation

> **Parallel Stream ID:** `STREAM-INFRA`
> **Depends On:** Nothing — this is the foundation all other streams need
> **Blocks:** Stream 1 (Exchange), Stream 3 (Banking), Stream 4 (VTU/KYC), Stream 5 (Multi-Platform/Admin)
> **Target Score:** Affects all categories → lifts platform Prod Readiness from 46→75

---

## Current State

| Dimension | Score | Root Cause |
|---|---|---|
| API & Developer | 78 | API is solid but needs production deployment + monitoring |
| Security | 70 | Code-complete but production secrets, pen-testing, dependency scanning missing |
| Performance & Reliability | 55 | Caching/Docker/logging exist but no production deployment, no load testing, no CI/CD |

**The Platform Has Zero Production Infrastructure.** No backend deployed, no managed database, no secret manager, no CI/CD pipeline running. This stream is the foundation every other stream needs.

---

## Phase 1: Production Environment Provisioning

### Task 1.1 — Provision Managed PostgreSQL
- **Action:** Select a managed PostgreSQL provider (AWS RDS, DigitalOcean Managed DB, Render, or Fly.io). Provision instance with: SSL/TLS enforced, automated daily backups with 7-day retention, point-in-time recovery enabled, connection pooling (PgBouncer), minimum 2 vCPU / 4 GB RAM for staging.
- **Agent:** `general-purpose` — research providers, provision, document connection string
- **Acceptance:** Database provisioned; SSL connection verified; backup restore tested; `DATABASE_URL` ready for secret manager

### Task 1.2 — Provision Managed Redis
- **Action:** Select managed Redis (AWS ElastiCache, DigitalOcean, Upstash, or Render). Provision with: auth token, TLS encryption, private network access (VPC/VPN), maxmemory-policy=allkeys-lru, minimum 1 GB memory.
- **Agent:** `general-purpose` — provision Redis, document connection string
- **Acceptance:** Redis provisioned; auth + TLS verified; `REDIS_URL` ready for secret manager

### Task 1.3 — Select & Configure Secret Manager
- **Action:** Choose secret manager (AWS Secrets Manager, Doppler, Infisical, or env-level in Render/Fly.io). Create the full secret inventory from `BACKEND/.env.example` and `DOCS/KYC-GUIDE.MD`. Mark each secret as production/staging/both.
- **Agent:** `general-purpose` — create secret inventory, configure secret manager
- **Acceptance:** All 30+ secrets documented and stored; backend can read secrets at runtime

### Task 1.4 — Deploy Backend to Production
- **Action:** Choose hosting (Render, Fly.io, Railway, or AWS ECS). Deploy NestJS backend with: HTTPS enabled, health check at `/api/health`, at least 2 instances for HA, environment=production, Swagger disabled, Sentry DSN configured, secrets injected from secret manager.
- **Agent:** `general-purpose` — create deployment config, deploy, verify
- **Acceptance:** Backend responds on HTTPS; `/api/health` returns 200; Swagger not accessible; logs flowing to provider dashboard

### Task 1.5 — Deploy Web/Admin to Production
- **Action:** Deploy Next.js website to Vercel (or same platform as backend). Set `NEXT_PUBLIC_API_URL` to production backend URL. Configure environment variables. Verify all 27 routes render without errors.
- **Agent:** `general-purpose` — deploy to Vercel, run smoke test on all routes
- **Acceptance:** Production URL loads; all public routes accessible; dashboard routes protected behind auth; admin routes protected

### Task 1.6 — Run Database Migrations
- **Action:** Run `npx prisma migrate deploy` against staging database first, then production. Run `npx prisma generate` in the deployment environment. Verify all tables exist and foreign keys are intact.
- **Agent:** `general-purpose` — execute migrations, verify schema
- **Acceptance:** All Prisma migrations applied; zero drift between staging and production schema; Prisma client generated

---

## Phase 2: CI/CD Pipeline Finalization

### Task 2.1 — Backend CI Pipeline
- **Action:** Create `.github/workflows/ci-backend.yml`: on PR → lint (eslint), build (nest build), test (jest unit), migration-check (prisma migrate status). On merge to main → deploy to production.
- **Agent:** `general-purpose` — create workflow file, test with a PR
- **Acceptance:** CI runs on PR; build fails block merge; deploy triggers on merge to main

### Task 2.2 — Web CI Pipeline
- **Action:** Create `.github/workflows/ci-web.yml`: on PR → lint (next lint), build (next build), test (vitest), e2e smoke (playwright). On merge to main → deploy to Vercel.
- **Agent:** `general-purpose` — create workflow file, test with a PR
- **Acceptance:** CI runs on PR; build/lint/test failures block merge; deploy triggers on merge

### Task 2.3 — Flutter CI Pipeline
- **Action:** Create `.github/workflows/ci-flutter.yml`: on PR → flutter analyze, flutter test. On merge to main → build APK/IPA artifacts.
- **Agent:** `general-purpose` — create workflow file, test with a PR
- **Acceptance:** Flutter analyze + test run on PR; failures block merge

### Task 2.4 — Dependency Vulnerability Scanning
- **Action:** Add `npm audit` (backend + web) and `dart pub outdated` (Flutter) to CI. Configure Dependabot or Renovate for automated dependency updates. Add Snyk or Trivy for container scanning.
- **Agent:** `general-purpose` — configure scanning, review initial results, fix critical/high findings
- **Acceptance:** Vulnerability scan runs in CI; critical/high findings block merge; auto-PR for dependency updates

---

## Phase 3: Security Hardening

### Task 3.1 — Production Secret Configuration
- **Action:** Rotate all secrets from development defaults to production values. Generate new: JWT_SECRET (256-bit), JWT_REFRESH_SECRET (256-bit), PII_ENCRYPTION_KEY (256-bit AES), BANK_ACCOUNT_ENCRYPTION_KEY (256-bit). Store all in secret manager, never in .env files or code.
- **Agent:** `general-purpose` — generate keys, store in secret manager, verify no secrets in codebase with `gitleaks detect`
- **Acceptance:** Zero secrets in codebase; all secrets in secret manager; JWT/PII keys are unique per environment

### Task 3.2 — Security Penetration Testing
- **Action:** Execute the manual security checklist from `DOCS/TESTING-GUIDE.MD`: JWT expiry (15m access/7d refresh), rate limiting threshold, account lockout (5 failed attempts), CORS origin rejection, XSS sanitization, SQL injection (Prisma ORM), webhook signature forgery, privilege escalation attempt, negative amount injection, concurrent exchange race condition.
- **Agent:** `general-purpose` — write and execute security test script with curl/Supertest
- **Acceptance:** All 10 security tests pass; any failures documented and fixed

### Task 3.3 — HTTPS & Network Security
- **Action:** Verify: HTTPS enforced on all endpoints, HSTS header set, CORS allowlist restricted to production domains only, Helmet headers configured (CSP, X-Frame-Options, X-Content-Type-Options), rate limiting tuned for production traffic.
- **Agent:** `general-purpose` — audit with `curl -I` and securityheaders.com, fix gaps
- **Acceptance:** HTTPS only (HTTP redirects to HTTPS); HSTS max-age=31536000; CORS only allows production frontend origin; Helmet score A+

### Task 3.4 — Audit Log Completeness Verification
- **Action:** Review every admin financial mutation endpoint and verify it creates an `AuditLog` entry with: actor (admin user ID), action type, reason (required field), before/after values, target entity ID, reference number, timestamp. If any endpoint is missing audit, add it.
- **Agent:** `general-purpose` — audit all admin controller methods, verify audit log writes
- **Acceptance:** 100% of admin financial actions audited; audit log includes all 7 required fields

---

## Phase 4: Monitoring & Observability

### Task 4.1 — Sentry Error Tracking
- **Action:** Create Sentry project for TRUSTPAY. Configure Sentry SDK in: NestJS backend (global exception filter → Sentry), Next.js web (error boundary → Sentry), Flutter app (Sentry Flutter SDK). Set up alert rules for: new unhandled errors, error rate spike >5%, transaction failure rate >1%.
- **Agent:** `general-purpose` — configure Sentry SDK in all 3 codebases, verify error capture
- **Acceptance:** Unhandled errors appear in Sentry dashboard; alert rules configured; source maps uploaded for web + mobile

### Task 4.2 — Uptime Monitoring
- **Action:** Configure uptime monitoring (Better Uptime, Pingdom, or provider-native health checks) for: `/api/health` (backend), `/` (web landing page), `/api/health` from multiple geographic regions. Alert on: response time >1s, SSL cert expiring <14 days, downtime >60s.
- **Agent:** `general-purpose` — set up monitoring, configure alerts
- **Acceptance:** Uptime dashboard active; alerts routing to email/Slack; 3+ geographic probe locations

### Task 4.3 — Performance Baseline & Load Testing
- **Action:** Run k6 or Artillery load test against staging: 50 virtual users for 30s on health check, login, get wallets, create quote. Record baseline P50/P95/P99 response times. Verify targets from `DOCS/TESTING-GUIDE.MD`: health <50ms, login <200ms, wallets <100ms, quote <300ms.
- **Agent:** `general-purpose` — write load test script, execute against staging, analyze results
- **Acceptance:** All endpoints meet latency targets; database connection pool not exhausted; Redis cache hit ratio >90%

### Task 4.4 — Database Backup & Restore Drill
- **Action:** Verify automated backups are running (daily). Execute a restore drill: restore latest backup to a temporary database, verify table integrity, run Prisma migration status, verify row counts match expected.
- **Agent:** `general-purpose` — initiate restore, verify integrity, document RTO/RPO
- **Acceptance:** Backup restore successful; RTO <30 minutes; RPO <24 hours; documented restore procedure

---

## Phase 5: Feature Flags & Environment Management

### Task 5.1 — Feature Flag System
- **Action:** Implement feature flags (environment variables + Redis overrides) for: `BANKING_ENABLED`, `VIRTUAL_ACCOUNTS_ENABLED`, `VTU_ENABLED`, `EXCHANGE_REVIEW_REQUIRED`, `WITHDRAWALS_ENABLED`, `BANKING_SANDBOX_MODE`. Each flag gates the relevant controller/endpoint.
- **Agent:** `general-purpose` — add flag checks to controllers, document all flags
- **Acceptance:** Disabling a flag returns 503 with clear message; flags toggleable without redeploy; admin UI shows current flag states

### Task 5.2 — Staging/Production Environment Parity
- **Action:** Ensure staging mirrors production: same PostgreSQL version, same Redis version, same backend version, same web version, sandbox provider credentials (vs live in prod), `BANKING_SANDBOX_MODE=true` (vs false in prod). Document any intentional differences.
- **Agent:** `general-purpose` — audit staging vs production config, fix drift
- **Acceptance:** Staging ↔ Production diff document created; only intentional differences remain (credentials, sandbox mode)

---

## Success Metrics

| Metric | Current | Target |
|---|---|---|
| Production Backend | ❌ Not deployed | ✅ Deployed, HTTPS, HA |
| Production Database | ❌ Docker only | ✅ Managed, SSL, backups |
| Production Redis | ❌ Docker only | ✅ Managed, TLS, auth |
| Secret Management | ❌ .env files | ✅ Secret manager, zero code secrets |
| CI/CD Pipeline | ❌ Not configured | ✅ Lint/Build/Test/Deploy on PR |
| Security Audit | ⚠️ Code-only | ✅ Pen-tested, all 10 checks pass |
| Error Tracking | ❌ None | ✅ Sentry with alerts |
| Uptime Monitoring | ❌ None | ✅ Multi-region health checks |
| Load Testing | ❌ Never run | ✅ Baseline established, targets met |
| Backup & Restore Drill | ❌ Not tested | ✅ Drill passed, RTO <30min |
| Feature Flags | ❌ None | ✅ Per-feature toggles with admin UI |

---

## Agent Execution Guide

```bash
# Terminal 2: Core Infrastructure Stream

# Phase 1: Provision everything
claude "Execute Phase 1 of DOCS/PARALLEL-WORKSTREAMS/02-CORE-INFRASTRUCTURE.md — provision prod infra"
# Phase 2: CI/CD
claude "Execute Phase 2 of DOCS/PARALLEL-WORKSTREAMS/02-CORE-INFRASTRUCTURE.md — set up CI/CD"
# Phase 3: Security hardening
claude "Execute Phase 3 of DOCS/PARALLEL-WORKSTREAMS/02-CORE-INFRASTRUCTURE.md — security audit and hardening"
# Phase 4: Monitoring
claude "Execute Phase 4 of DOCS/PARALLEL-WORKSTREAMS/02-CORE-INFRASTRUCTURE.md — monitoring and observability"
# Phase 5: Feature flags
claude "Execute Phase 5 of DOCS/PARALLEL-WORKSTREAMS/02-CORE-INFRASTRUCTURE.md — feature flags and env parity"
```

---

## Dependencies

| Stream | Needs From This Stream | Status |
|---|---|---|
| Stream 1 (Exchange) | Production backend + DB + secrets | 🔜 Required before Exchange Phase 4 |
| Stream 3 (Banking) | Production backend + DB + secrets + Monnify webhook URL | 🔜 Required before Banking Phase 3 |
| Stream 4 (VTU/KYC) | Production backend + DB + secrets + Supabase bucket | 🔜 Required before VTU/KYC Phase 2 |
| Stream 5 (Multi-Platform) | Production backend URL + CI/CD | 🔜 Required before Multi-Platform Phase 3 |

---

*Last updated: 2026-05-31 | Stream ID: STREAM-INFRA*
