CREATE TYPE "PaymentProvider" AS ENUM ('PAYSTACK', 'FLUTTERWAVE');
CREATE TYPE "VirtualAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'FAILED', 'DISABLED');
CREATE TYPE "ProviderEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "TransferAttemptStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED');

ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'INTERNAL_TRANSFER';

CREATE TABLE "ledger_entries" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "direction" "LedgerDirection" NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "currency" "WalletCurrency" NOT NULL,
  "balanceBefore" DECIMAL(15,2) NOT NULL,
  "balanceAfter" DECIMAL(15,2) NOT NULL,
  "reference" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "virtual_accounts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "providerAccountId" TEXT,
  "providerCustomerId" TEXT,
  "accountNumber" TEXT NOT NULL,
  "accountNumberMasked" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "bankCode" TEXT,
  "currency" "WalletCurrency" NOT NULL,
  "status" "VirtualAccountStatus" NOT NULL DEFAULT 'PENDING',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "virtual_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bank_accounts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "PaymentProvider",
  "bankCode" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "accountNumberEncrypted" TEXT NOT NULL,
  "accountNumberMasked" TEXT NOT NULL,
  "currency" "WalletCurrency" NOT NULL,
  "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_events" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "eventType" TEXT NOT NULL,
  "providerReference" TEXT NOT NULL,
  "status" "ProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "payload" JSONB NOT NULL,
  "payloadHash" TEXT,
  "errorMessage" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transfer_attempts" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "providerReference" TEXT NOT NULL,
  "providerStatus" TEXT NOT NULL,
  "status" "TransferAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "attemptNo" INTEGER NOT NULL DEFAULT 1,
  "lastCheckedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transfer_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "adminId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "reference" TEXT,
  "reason" TEXT,
  "before" JSONB,
  "after" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ledger_entries_walletId_createdAt_idx" ON "ledger_entries"("walletId", "createdAt" DESC);
CREATE INDEX "ledger_entries_transactionId_idx" ON "ledger_entries"("transactionId");
CREATE INDEX "ledger_entries_reference_idx" ON "ledger_entries"("reference");
CREATE UNIQUE INDEX "virtual_accounts_userId_provider_currency_key" ON "virtual_accounts"("userId", "provider", "currency");
CREATE UNIQUE INDEX "virtual_accounts_provider_accountNumber_key" ON "virtual_accounts"("provider", "accountNumber");
CREATE INDEX "virtual_accounts_userId_status_idx" ON "virtual_accounts"("userId", "status");
CREATE INDEX "virtual_accounts_provider_status_idx" ON "virtual_accounts"("provider", "status");
CREATE INDEX "bank_accounts_userId_isDeleted_idx" ON "bank_accounts"("userId", "isDeleted");
CREATE INDEX "bank_accounts_bankCode_idx" ON "bank_accounts"("bankCode");
CREATE UNIQUE INDEX "provider_events_provider_providerReference_eventType_key" ON "provider_events"("provider", "providerReference", "eventType");
CREATE INDEX "provider_events_provider_status_idx" ON "provider_events"("provider", "status");
CREATE INDEX "provider_events_createdAt_idx" ON "provider_events"("createdAt");
CREATE UNIQUE INDEX "transfer_attempts_provider_providerReference_key" ON "transfer_attempts"("provider", "providerReference");
CREATE INDEX "transfer_attempts_transactionId_idx" ON "transfer_attempts"("transactionId");
CREATE INDEX "transfer_attempts_status_idx" ON "transfer_attempts"("status");
CREATE INDEX "audit_logs_adminId_idx" ON "audit_logs"("adminId");
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");
CREATE INDEX "audit_logs_reference_idx" ON "audit_logs"("reference");

ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "virtual_accounts" ADD CONSTRAINT "virtual_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transfer_attempts" ADD CONSTRAINT "transfer_attempts_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amount_positive_check" CHECK ("amount" > 0);
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_non_negative_check" CHECK ("balance" >= 0);
