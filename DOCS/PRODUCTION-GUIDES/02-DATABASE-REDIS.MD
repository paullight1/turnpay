# Production Guide: Database And Redis

## Scope

Use this guide for production PostgreSQL, Prisma migrations, Redis, backups, TLS, idempotency storage, rate limits, and queue readiness. Local Docker can validate startup, but production requires managed infrastructure, private networking, backup policy, and restore testing.

## Required Env Vars

```env
DATABASE_URL=postgresql://USER:PASSWORD@SUPABASE_HOST:5432/postgres?sslmode=require&schema=public
REDIS_URL=rediss://USER:PASSWORD@REVIEWED_HOST:6379
REDIS_ALLOW_MEMORY_FALLBACK=false
```

Production `DATABASE_URL` must require TLS and use the approved Supabase direct/session-pooler endpoint on port 5432. Production startup requires `REDIS_URL`; separate host/port/password variables do not replace it. Verify authentication, persistence and the actual TLS/private-network policy. Do not reuse staging or local credentials.

## Backup policy and restore evidence

Run `BACKEND/scripts/backup-db.sh` at least daily (the recommended schedule is
every six hours) from an operator or scheduled job with access to the managed
database. Set `BACKUP_DIR` to a private durable volume or encrypted object
storage mount and keep `BACKUP_ENCRYPTION_KEY_FILE` in the deployment secret
manager. The script rejects non-TLS database URLs, writes only AES-256
encrypted custom-format archives, sets the directory to `0700` and archives to
`0600`, and retains at least 30 days. It reads the database password through a
private libpq passfile so the password is not placed in `pg_dump` arguments.

```bash
DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=verify-full&schema=public' \
BACKUP_DIR=/var/backups/trustpay \
BACKUP_ENCRYPTION_KEY_FILE=/run/secrets/trustpay-backup-key \
RETENTION_DAYS=30 \
  ./BACKEND/scripts/backup-db.sh
```

After each backup policy change, run
`BACKEND/scripts/verify-backup-restore.sh` against a disposable target. The
restore drill compares source and restored counts plus Decimal wallet,
transaction, and ledger aggregates, audit rows, provider events, webhook
inbox rows, and VTU orders. Attach the run transcript with measured RPO/RTO;
the CI fixture is synthetic evidence only.

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
3. Set production `DATABASE_URL` and authenticated `REDIS_URL`, with `REDIS_ALLOW_MEMORY_FALLBACK=false`.
4. Run migrations during a release window with rollback and backup references recorded.
5. Confirm connection pooling and maximum database connections match deployment concurrency.
6. Enable database, Redis, and application health alerts.
7. Perform a restore test before first money-flow launch.

## Verification Checklist

- [ ] Prisma migrations apply cleanly in staging and production.
- [ ] Production database access requires TLS and strong credentials.
- [ ] Daily encrypted backups are retained for at least 30 days and one restore has been tested with financial evidence comparison.
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
