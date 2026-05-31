-- Track internal transfer attempts for support/fraud review and enforce
-- per-user transfer velocity without relying on read-then-write counters.
CREATE TYPE "InternalTransferAttemptStatus" AS ENUM ('SUCCESS', 'FAILED');
CREATE TYPE "TransferLimitPeriod" AS ENUM ('DAILY', 'MONTHLY');

CREATE TABLE "internal_transfer_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "transferReference" TEXT,
    "senderTransactionId" TEXT,
    "recipientTransactionId" TEXT,
    "status" "InternalTransferAttemptStatus" NOT NULL,
    "amount" DECIMAL(15,2),
    "currency" "WalletCurrency",
    "recipientIdentifierType" TEXT,
    "recipientMaskedIdentifier" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_transfer_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "internal_transfer_limit_usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" "WalletCurrency" NOT NULL,
    "period" "TransferLimitPeriod" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_transfer_limit_usage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "internal_transfer_attempts_userId_createdAt_idx" ON "internal_transfer_attempts"("userId", "createdAt" DESC);
CREATE INDEX "internal_transfer_attempts_status_createdAt_idx" ON "internal_transfer_attempts"("status", "createdAt");
CREATE INDEX "internal_transfer_attempts_transferReference_idx" ON "internal_transfer_attempts"("transferReference");

CREATE UNIQUE INDEX "internal_transfer_limit_usage_userId_currency_period_periodStart_key"
ON "internal_transfer_limit_usage"("userId", "currency", "period", "periodStart");
CREATE INDEX "internal_transfer_limit_usage_userId_currency_period_idx" ON "internal_transfer_limit_usage"("userId", "currency", "period");
CREATE INDEX "internal_transfer_limit_usage_periodStart_idx" ON "internal_transfer_limit_usage"("periodStart");

ALTER TABLE "internal_transfer_attempts"
ADD CONSTRAINT "internal_transfer_attempts_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "internal_transfer_limit_usage"
ADD CONSTRAINT "internal_transfer_limit_usage_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
