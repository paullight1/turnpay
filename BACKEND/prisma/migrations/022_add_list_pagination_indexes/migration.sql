-- Indexes backing admin/list queries that ORDER BY createdAt (and status+createdAt)
-- on append-only, unbounded tables. Without these Postgres sorts the whole table
-- on every admin page / dashboard load, degrading linearly as data grows.
--
-- NOTE: on very large existing tables a plain CREATE INDEX takes an ACCESS
-- EXCLUSIVE lock. If these tables are already large in production, create the
-- same indexes manually with CREATE INDEX CONCURRENTLY (outside a transaction)
-- before deploying, so this migration becomes a no-op via IF NOT EXISTS.

-- AuditLog: most-hit, worst-scaling — getAuditLogs / dashboard recentAuditLogs
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx" ON "audit_logs"("createdAt" DESC);

-- User: admin user list default ordering
CREATE INDEX IF NOT EXISTS "users_createdAt_idx" ON "users"("createdAt" DESC);

-- VirtualAccount: admin virtual-account list ordering
CREATE INDEX IF NOT EXISTS "virtual_accounts_createdAt_idx" ON "virtual_accounts"("createdAt" DESC);

-- Transaction: status + createdAt range scans (platform trend, ops summaries)
CREATE INDEX IF NOT EXISTS "transactions_status_createdAt_idx" ON "transactions"("status", "createdAt");

-- VtuOrder: stale-order sweeps filtering by status and ordering by createdAt
CREATE INDEX IF NOT EXISTS "vtu_orders_status_createdAt_idx" ON "vtu_orders"("status", "createdAt");
