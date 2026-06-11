CREATE TYPE "RateOverrideStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

CREATE TABLE "rate_overrides" (
    "id" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "proposedRate" DECIMAL(10,4) NOT NULL,
    "proposedMarkup" DECIMAL(5,2) NOT NULL,
    "currentRate" DECIMAL(10,4) NOT NULL,
    "deviationPercent" DECIMAL(6,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RateOverrideStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvedById" TEXT,
    "reviewReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_overrides_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rate_alerts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "targetRate" DECIMAL(10,4) NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'ABOVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "triggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rate_overrides_status_createdAt_idx" ON "rate_overrides"("status", "createdAt");
CREATE INDEX "rate_alerts_userId_isActive_idx" ON "rate_alerts"("userId", "isActive");
CREATE INDEX "rate_alerts_isActive_idx" ON "rate_alerts"("isActive");

ALTER TABLE "rate_overrides"
ADD CONSTRAINT "rate_overrides_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rate_overrides"
ADD CONSTRAINT "rate_overrides_approvedById_fkey"
FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "rate_alerts"
ADD CONSTRAINT "rate_alerts_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
