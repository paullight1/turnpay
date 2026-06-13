-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "ExchangePayoutStatus" AS ENUM (
    'PENDING_APPROVAL',
    'APPROVED',
    'PROCESSING',
    'SENT',
    'FAILED',
    'REVERSED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "exchange_payouts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "sourceCurrency" "WalletCurrency" NOT NULL DEFAULT 'NGN',
  "destinationCurrency" "WalletCurrency" NOT NULL DEFAULT 'GHS',
  "sourceAmount" DECIMAL(15,2) NOT NULL,
  "destinationAmount" DECIMAL(15,2) NOT NULL,
  "rate" DECIMAL(18,6) NOT NULL,
  "fee" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "destinationBankName" TEXT NOT NULL,
  "destinationBankCode" TEXT,
  "destinationAccountNumber" TEXT NOT NULL,
  "destinationAccountName" TEXT NOT NULL,
  "status" "ExchangePayoutStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "adminId" TEXT,
  "adminNote" TEXT,
  "adminPaymentReceipt" TEXT,
  "notificationSent" BOOLEAN NOT NULL DEFAULT false,
  "reviewedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "exchange_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_payouts_transactionId_key" ON "exchange_payouts"("transactionId");
CREATE INDEX IF NOT EXISTS "exchange_payouts_status_createdAt_idx" ON "exchange_payouts"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "exchange_payouts_userId_status_idx" ON "exchange_payouts"("userId", "status");

-- AddForeignKey
ALTER TABLE "exchange_payouts"
  ADD CONSTRAINT "exchange_payouts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exchange_payouts"
  ADD CONSTRAINT "exchange_payouts_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "transactions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
