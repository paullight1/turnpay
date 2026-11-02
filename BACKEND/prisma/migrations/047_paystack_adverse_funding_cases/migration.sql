CREATE TYPE "FundingAdverseCaseStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED');

CREATE TYPE "FundingAdverseVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'UNMATCHED');

CREATE TABLE "funding_adverse_cases" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerReference" TEXT NOT NULL,
    "fundingReference" TEXT,
    "transactionId" TEXT,
    "userId" TEXT,
    "currency" "WalletCurrency",
    "exposureAmount" DECIMAL(15,2),
    "recoveredAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "FundingAdverseCaseStatus" NOT NULL DEFAULT 'OPEN',
    "verificationStatus" "FundingAdverseVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "holdRequired" BOOLEAN NOT NULL DEFAULT true,
    "providerStatus" TEXT,
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_adverse_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "funding_adverse_cases_provider_event_key"
    ON "funding_adverse_cases"("provider", "eventType", "providerReference");

CREATE INDEX "funding_adverse_cases_active_hold_idx"
    ON "funding_adverse_cases"("status", "holdRequired");

CREATE INDEX "funding_adverse_cases_user_status_idx"
    ON "funding_adverse_cases"("userId", "status");

CREATE INDEX "funding_adverse_cases_funding_status_idx"
    ON "funding_adverse_cases"("fundingReference", "status");

ALTER TABLE "funding_adverse_cases"
    ADD CONSTRAINT "funding_adverse_cases_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "funding_adverse_cases"
    ADD CONSTRAINT "funding_adverse_cases_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
