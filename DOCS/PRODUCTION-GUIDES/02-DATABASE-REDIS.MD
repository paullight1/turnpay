# Production Guide: Database And Redis

## Scope

Use this guide for production PostgreSQL, Prisma migrations, Redis, backups, TLS, idempotency storage, rate limits, and queue readiness. Local Docker can validate startup, but production requires managed infrastructure, private networking, backup policy, and restore testing.

## Required Env Vars

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB?schema=public
REDIS_HOST=
REDIS_PORT=6379
REDIS_PASSWORD=
RECONCILIATION_CRON=0 */1 * * *
WEBHOOK_QUEUE_NAME=banking-webhooks
DLQ_NAME=banking-dead-letter
ADMIN_REVIEW_WEBHOOK_ALERT_CHANNEL=
```

Production `DATABASE_URL` should require SSL/TLS where supported by the host. Do not reuse local credentials.

## Sandbox Steps

1. Restore or migrate a staging database from a sanitized baseline.
2. Run Prisma migrations against staging before production.
3. Seed only test users, test wallets, and test provider references.
4. Confirm Redis authentication and network access from backend only.
5. Run idempotency, rate-limit, and cache expiry tests.
6. Simulate Redis outage and confirm sensitive endpoints fail closed or degrade safely.

## Live Steps

1. Provision production PostgreSQL with private networking, TLS, point-in-time recovery, and daily backups.
2. Provision Redis with authentication, encryption in transit where available, and private access.
3. Set production `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD`.
4. Run migrations during a release window with rollback and backup references recorded.
5. Confirm connection pooling and maximum database connections match deployment concurrency.
6. Enable database, Redis, and application health alerts.
7. Perform a restore test before first money-flow launch.

## Verification Checklist

- [ ] Prisma migrations apply cleanly in staging and production.
- [ ] Production database access requires TLS and strong credentials.
- [ ] Backups exist and one restore has been tested.
- [ ] Redis is not publicly reachable.
- [ ] Idempotency keys persist for at least 24 hours.
- [ ] Balance mutation tests prove no negative balances under concurrent requests.
- [ ] Reconciliation jobs can read all required transaction, ledger, wallet, webhook, and provider-attempt tables.
- [ ] Database errors are not exposed to clients.

## Launch Blockers

- No tested backup restore.
- Manual production schema changes outside migrations.
- Redis open without password or public network restrictions.
- Any wallet balance operation that is not transactionally protected.
- Missing indexes or constraints that allow duplicate provider references.
