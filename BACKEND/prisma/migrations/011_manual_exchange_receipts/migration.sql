-- CreateEnum
CREATE TYPE "ExchangeReceiptStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'CREDITED', 'REJECTED', 'NEEDS_MORE_INFO');

-- CreateTable
CREATE TABLE "exchange_receipts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "sourceCurrency" "WalletCurrency" NOT NULL DEFAULT 'NGN',
    "targetCurrency" "WalletCurrency" NOT NULL DEFAULT 'GHS',
    "amount" DECIMAL(15,2) NOT NULL,
    "expectedCreditAmount" DECIMAL(15,2) NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "markupPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "bankReference" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderBankName" TEXT,
    "receiptUrl" TEXT NOT NULL,
    "status" "ExchangeReceiptStatus" NOT NULL DEFAULT 'SUBMITTED',
    "adminId" TEXT,
    "reviewReason" TEXT,
    "creditedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exchange_receipts_transactionId_key" ON "exchange_receipts"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_receipts_bankReference_key" ON "exchange_receipts"("bankReference");

-- CreateIndex
CREATE INDEX "exchange_receipts_status_createdAt_idx" ON "exchange_receipts"("status", "createdAt");

-- CreateIndex
CREATE INDEX "exchange_receipts_userId_status_idx" ON "exchange_receipts"("userId", "status");

-- AddForeignKey
ALTER TABLE "exchange_receipts" ADD CONSTRAINT "exchange_receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_receipts" ADD CONSTRAINT "exchange_receipts_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
