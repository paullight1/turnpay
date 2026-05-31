# 🗄️ Database Migration Runbook

> **Guide ID:** `PROD-20-MIGRATIONS`
> **Stream:** STREAM-INFRA Phase 1.6
> **Migrations:** 16 Prisma migrations (000_init → 015_idempotency_failed_response)
> **Last Updated:** 2026-05-31

---

## Pre-Migration Checklist

### Before running migrations on staging:

- [ ] **Backup verified** — latest automated backup is <24 hours old
- [ ] **DATABASE_URL set** — points to the correct database (staging first!)
- [ ] **Prisma CLI available** — `npx prisma --version`
- [ ] **Database reachable** — `npx prisma migrate status` succeeds
- [ ] **No pending manual changes** — schema matches migration history
- [ ] **Application scaled down or in maintenance mode** (production only)
- [ ] **Rollback plan documented** — you know how to restore from backup

---

## Step-by-Step: Staging Migration

### 1. Verify Database Connectivity

```bash
cd BACKEND

# Check connection
DATABASE_URL="postgresql://trustpay:PASS@staging-host:25060/trustpay_db?sslmode=require" \
  npx prisma migrate status
```

Expected output:
```
16 migrations found in prisma/migrations
Database schema is up to date
```

### 2. Review Pending Migrations

```bash
# List all migrations with status
DATABASE_URL="..." npx prisma migrate status

# If there are unapplied migrations, review them:
ls -la prisma/migrations/
```

### 3. Apply Migrations

```bash
DATABASE_URL="postgresql://trustpay:PASS@staging-host:25060/trustpay_db?sslmode=require" \
  npx prisma migrate deploy
```

Expected output:
```
16 migrations found in prisma/migrations
Applying migration `000_init_trustpay_schema`
Applying migration `001_...`
...
All migrations have been successfully applied.
```

### 4. Generate Prisma Client

```bash
npx prisma generate
```

### 5. Verify Schema Integrity

```sql
-- Connect to staging database
psql "postgresql://trustpay:PASS@staging-host:25060/trustpay_db?sslmode=require"

-- List all tables (should match 22 models)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Verify foreign keys are intact
SELECT
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name;

-- Verify all required tables exist
SELECT 'User' AS model, COUNT(*) FROM "User" UNION ALL
SELECT 'Wallet', COUNT(*) FROM "Wallet" UNION ALL
SELECT 'Transaction', COUNT(*) FROM "Transaction" UNION ALL
SELECT 'ExchangeReceipt', COUNT(*) FROM "ExchangeReceipt" UNION ALL
SELECT 'ExchangePayout', COUNT(*) FROM "ExchangePayout" UNION ALL
SELECT 'LedgerEntry', COUNT(*) FROM "LedgerEntry" UNION ALL
SELECT 'VirtualAccount', COUNT(*) FROM "VirtualAccount" UNION ALL
SELECT 'BankAccount', COUNT(*) FROM "BankAccount" UNION ALL
SELECT 'VtuOrder', COUNT(*) FROM "VtuOrder" UNION ALL
SELECT 'VtuPricingRule', COUNT(*) FROM "VtuPricingRule" UNION ALL
SELECT 'AuditLog', COUNT(*) FROM "AuditLog" UNION ALL
SELECT 'Rate', COUNT(*) FROM "Rate" UNION ALL
SELECT 'Service', COUNT(*) FROM "Service" UNION ALL
SELECT 'KycDocument', COUNT(*) FROM "KycDocument" UNION ALL
SELECT 'KycVerification', COUNT(*) FROM "KycVerification" UNION ALL
SELECT 'Dispute', COUNT(*) FROM "Dispute" UNION ALL
SELECT 'RefreshToken', COUNT(*) FROM "RefreshToken" UNION ALL
SELECT 'InternalTransferAttempt', COUNT(*) FROM "InternalTransferAttempt" UNION ALL
SELECT 'InternalTransferLimitUsage', COUNT(*) FROM "InternalTransferLimitUsage" UNION ALL
SELECT 'IdempotencyRecord', COUNT(*) FROM "IdempotencyRecord" UNION ALL
SELECT 'ProviderEvent', COUNT(*) FROM "ProviderEvent" UNION ALL
SELECT 'TransferAttempt', COUNT(*) FROM "TransferAttempt" UNION ALL
SELECT 'WebhookLog', COUNT(*) FROM "WebhookLog";
```

### 6. Run Seed (Staging Only)

```bash
# Seed staging with test data
DATABASE_URL="..." npx ts-node prisma/seed.ts
```

Create test users: `test@trustpay.com` and `admin@trustpay.com`.

---

## Step-by-Step: Production Migration

### ⚠️ WARNING: Production migration requires extra care.

### 1. Create Pre-Migration Backup

```bash
# Verify latest automated backup exists
# On DigitalOcean: Databases → trustpay-postgres-db → Backups

# If backup is older than 1 hour, trigger manual backup:
doctl databases backup create YOUR_DATABASE_ID

# Wait for backup to complete
doctl databases backup-list YOUR_DATABASE_ID
```

### 2. Put Application in Maintenance Mode (Optional)

For fintech apps, consider maintenance mode to prevent writes during migration:

```bash
# Set maintenance flag in Redis
redis-cli -h REDIS_HOST -p REDIS_PORT -a REDIS_PASS --tls \
  SET maintenance_mode true EX 300

# Verify app returns 503
curl -s -o /dev/null -w "%{http_code}" https://api.trustpay.xyz/api/health
```

### 3. Apply Migrations

```bash
cd BACKEND

DATABASE_URL="postgresql://trustpay:PROD_PASS@prod-host:25060/trustpay_db?sslmode=require" \
  npx prisma migrate deploy
```

**⚠️ If migration fails:**
1. **STOP.** Do not retry immediately.
2. Check the error message — is it a conflict, lock timeout, or schema mismatch?
3. If safe, restore from backup and re-attempt.
4. If unsure, escalate to the team.

### 4. Generate Prisma Client

```bash
DATABASE_URL="..." npx prisma generate
```

### 5. Verify Production Schema

Run the same verification queries as staging (Step 5 above).

### 6. Turn Off Maintenance Mode

```bash
redis-cli -h REDIS_HOST -p REDIS_PORT -a REDIS_PASS --tls \
  DEL maintenance_mode
```

### 7. Verify Application Health

```bash
# Health check
curl -s https://api.trustpay.xyz/api/health | jq

# Should return:
# { "status": "ok", "checks": { "database": "connected", "redis": "connected" } }

# Test a simple authed endpoint
curl -s https://api.trustpay.xyz/api/wallets \
  -H "Authorization: Bearer $TEST_TOKEN" | jq
```

---

## Rollback Procedure

### If migration fails in production:

```bash
# 1. Identify the failed migration
DATABASE_URL="..." npx prisma migrate status
# Note: which migration failed

# 2. Restore from backup (DigitalOcean)
doctl databases backup restore YOUR_DATABASE_ID \
  --backup-id LATEST_BACKUP_ID \
  --target-database trustpay-postgres-db

# Wait for restore to complete (~5-15 min depending on DB size)

# 3. Verify restore
DATABASE_URL="..." npx prisma migrate status
# Should show: all previously applied migrations

# 4. Verify data integrity
psql "PROD_DATABASE_URL" -c "SELECT COUNT(*) FROM \"User\""
psql "PROD_DATABASE_URL" -c "SELECT COUNT(*) FROM \"Wallet\""
psql "PROD_DATABASE_URL" -c "SELECT COUNT(*) FROM \"Transaction\""

# 5. Re-enable application
redis-cli ... DEL maintenance_mode

# 6. Verify health
curl -s https://api.trustpay.xyz/api/health | jq
```

---

## Schema Drift Detection

### Check for drift between staging and production:

```bash
# On staging
DATABASE_URL="staging_url" npx prisma migrate status > staging_status.txt

# On production
DATABASE_URL="prod_url" npx prisma migrate status > prod_status.txt

# Compare
diff staging_status.txt prod_status.txt
```

### Automated drift check in CI:

```bash
# Add to CI pipeline:
npx prisma migrate status
if [ $? -ne 0 ]; then
  echo "❌ Schema drift detected! Pending migrations exist."
  exit 1
fi
echo "✅ Schema is up to date"
```

---

## Migration List

| # | Migration Name | Description |
|---|---|---|
| 000 | `init_trustpay_schema` | Initial schema with all core models |
| 001 | (migration 1) | Schema evolution |
| 002 | (migration 2) | Schema evolution |
| ... | ... | ... |
| 015 | `idempotency_failed_response` | Idempotency support for failed responses |

Total: **16 migrations** (verify with `ls prisma/migrations/ | wc -l`)

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `P1001: Can't reach database server` | DATABASE_URL wrong or network issue | Verify hostname, check VPC/trusted sources |
| `P3009: Migrate found failed migration` | Previous migration failed mid-way | Restore from backup, re-run |
| `P3017: Migration already applied` | Safe — migration was already run | Ignore, continue |
| `P3008: Migration file changed` | Schema drift — migration file modified | Restore original migration or re-baseline |
| Lock timeout | Another migration running | Wait and retry; check for stuck locks |
| Permission denied | Database user lacks DDL privileges | Grant CREATE/ALTER on schema |

---

## Quick Reference

```bash
# Check status
npx prisma migrate status

# Apply pending migrations (safe, idempotent)
npx prisma migrate deploy

# Generate Prisma client (always after deploy)
npx prisma generate

# Create a new migration (dev only)
npx prisma migrate dev --name description_of_change

# Reset database (dev only — DESTROYS DATA)
npx prisma migrate reset

# View database in browser (dev only)
npx prisma studio
```

---

*Last updated: 2026-05-31 | Stream: STREAM-INFRA Phase 1.6*
