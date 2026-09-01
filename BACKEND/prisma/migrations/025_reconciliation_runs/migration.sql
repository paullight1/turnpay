CREATE TYPE "ReconciliationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'BLOCKED', 'FAILED');

CREATE TABLE "reconciliation_runs" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "status" "ReconciliationRunStatus" NOT NULL DEFAULT 'RUNNING',
  "initiatedById" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "checkedCount" INTEGER NOT NULL DEFAULT 0,
  "mismatchCount" INTEGER NOT NULL DEFAULT 0,
  "mismatchDetails" JSONB,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reconciliation_runs_scope_createdAt_idx"
ON "reconciliation_runs"("scope", "createdAt" DESC);

CREATE INDEX "reconciliation_runs_status_createdAt_idx"
ON "reconciliation_runs"("status", "createdAt" DESC);
