CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "KYCStatus" AS ENUM ('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED');
CREATE TYPE "KYCType" AS ENUM ('BVN', 'NIN', 'PASSPORT', 'DRIVERS_LICENSE', 'VOTERS_CARD');
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED', 'ESCALATED');
CREATE TYPE "TransactionType" AS ENUM ('EXCHANGE', 'FUND', 'WITHDRAW', 'AIRTIME', 'DATA', 'CABLE', 'ELECTRICITY');
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED');
CREATE TYPE "WalletCurrency" AS ENUM ('NGN', 'GHS');

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "kycStatus" "KYCStatus" NOT NULL DEFAULT 'PENDING',
    "dailyWithdrawLimit" DECIMAL(15,2) NOT NULL DEFAULT 500000,
    "monthlyWithdrawLimit" DECIMAL(15,2) NOT NULL DEFAULT 5000000,
    "dailyWithdrawn" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "monthlyWithdrawn" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "limitResetDate" TIMESTAMP(3),
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" "WalletCurrency" NOT NULL,
    "balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "WalletCurrency" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT NOT NULL,
    "fee" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rates" (
    "id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "markup" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'system',
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "kyc_documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "KYCType" NOT NULL,
    "documentUrl" TEXT NOT NULL,
    "idNumber" TEXT NOT NULL,
    "status" "KYCStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_logs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");
CREATE INDEX "refresh_tokens_tokenHash_idx" ON "refresh_tokens"("tokenHash");
CREATE UNIQUE INDEX "wallets_userId_currency_key" ON "wallets"("userId", "currency");
CREATE UNIQUE INDEX "transactions_reference_key" ON "transactions"("reference");
CREATE INDEX "transactions_userId_status_idx" ON "transactions"("userId", "status");
CREATE INDEX "transactions_userId_createdAt_idx" ON "transactions"("userId", "createdAt" DESC);
CREATE INDEX "transactions_walletId_idx" ON "transactions"("walletId");
CREATE INDEX "transactions_type_status_idx" ON "transactions"("type", "status");
CREATE UNIQUE INDEX "rates_from_to_key" ON "rates"("from", "to");
CREATE INDEX "kyc_documents_userId_status_idx" ON "kyc_documents"("userId", "status");
CREATE INDEX "disputes_userId_status_idx" ON "disputes"("userId", "status");
CREATE INDEX "disputes_transactionId_idx" ON "disputes"("transactionId");
CREATE UNIQUE INDEX "webhook_logs_reference_key" ON "webhook_logs"("reference");
CREATE INDEX "webhook_logs_provider_reference_idx" ON "webhook_logs"("provider", "reference");
CREATE INDEX "webhook_logs_processed_idx" ON "webhook_logs"("processed");

ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "rates" ("id", "from", "to", "rate", "markup", "source", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'GHS', 'NGN', 3.1746, 2.50, 'system', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'NGN', 'GHS', 0.3150, 2.50, 'system', CURRENT_TIMESTAMP)
ON CONFLICT ("from", "to") DO NOTHING;

INSERT INTO "services" ("id", "name", "type", "provider", "isActive", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'MTN', 'airtime', 'mtn', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Airtel', 'airtime', 'airtel', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Glo', 'airtime', 'glo', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'DStv', 'cable', 'dstv', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'GOtv', 'cable', 'gotv', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'StarTimes', 'cable', 'startimes', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Ikeja Electric', 'electricity', 'ikedc', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Eko Electric', 'electricity', 'ekedc', true, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
