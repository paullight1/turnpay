# Production migration runbook

Apply the checked-in Prisma migration history to the explicitly selected environment. Never use `prisma migrate dev`, schema push, reset, fixture SQL or seed data on production. Do not infer migration status from a fixed historical migration count.

## Prepare the release

1. Record the reviewed candidate commit, image digest, deployment host, database identity and migration operator. Confirm a recent encrypted backup and a tested restore procedure with measured recovery objectives.
2. Review new SQL in `BACKEND/prisma/migrations`, including locking, execution time and compatibility with the currently serving version. Migration `054_transactional_email_outbox` is required for transactional status email.
3. Set `DATABASE_URL` privately in the deployment environment. It must identify the isolated production Supabase direct/session-pooler endpoint on port 5432 with `sslmode=require` or stricter. Never print the URL in a transcript.
4. Rehearse the exact candidate on disposable infrastructure, including `scripts/check-migration-drift.sh` with an explicitly disposable `SHADOW_DATABASE_URL`. Never point the shadow URL at a database containing real data.
5. Coordinate one release migration job. Keep `RUN_MIGRATIONS_ON_STARTUP=false` on production serving instances; the proposed paid Render profile uses `preDeployCommand: npx prisma migrate deploy`. On Dokploy or another host, configure the equivalent controlled release job.

## Apply and verify

From `BACKEND`, with the target environment already configured privately:

```sh
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate status
```

A failed status before deploy can mean pending migrations; inspect the actual message. Successful deployment must be followed by a status reporting no unapplied migrations. A failed migration or divergent history requires investigation rather than blindly repeating the command.

Generate Prisma client and build the application during image creation, using the same schema as the migration job. Serving startup uses `NODE_ENV=production sh scripts/validate-production-config.sh node dist/src/main.js`; `npm run start:prod` runs the same guarded production entry point. Use the exact lowercase mode so shell, schema and raw environment checks agree.

After deployment, verify `/api/health/ready`, protected-route access, private storage and the candidate's affected user flows. Database connectivity alone does not prove required migrations are present. Confirm new tables retain RLS and revoked direct PUBLIC/anon/authenticated grants where specified. Do not grant blanket public access to resolve a backend permission error.

## Rollback and recovery

Preserve the failed migration output, deployment identity and backup reference. Disable affected financial features and prevent competing writers using the approved incident procedure. Do not assume setting an arbitrary Redis key establishes maintenance mode.

Prefer a reviewed forward repair when data and compatibility permit it. Restoring a backup is a coordinated recovery decision: it can discard financial writes accepted after the restore point, so finance must reconcile those provider outcomes before service resumes. Do not automatically mark a migration resolved or delete migration history.

## Disposable restore rehearsal

Use the existing `BACKEND/scripts/verify-backup-restore.sh` only with a separate disposable restore target. Its comparison covers wallet balances and financial table counts/totals. Synthetic fixture SQL in `scripts/restore-drill-fixture.sql` must never run on staging or production.

Attach the successful transcript, backup timestamp, elapsed restore time, reconciliation outcome and named recovery owner to the release record. A script unit test is not a restore rehearsal, and a local rehearsal is not evidence that production backups are configured.
