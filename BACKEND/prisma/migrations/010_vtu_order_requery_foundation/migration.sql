CREATE TYPE "VtuOrderProvider" AS ENUM ('GENERIC', 'VTPASS', 'RELOADLY');

CREATE TYPE "VtuOrderScope" AS ENUM ('LOCAL', 'INTERNATIONAL');

CREATE TYPE "VtuOrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED', 'UNKNOWN');

CREATE TABLE "vtu_orders" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "provider" "VtuOrderProvider" NOT NULL,
    "scope" "VtuOrderScope" NOT NULL,
    "serviceType" "TransactionType" NOT NULL,
    "countryCode" TEXT,
    "localProvider" TEXT,
    "operatorId" TEXT,
    "providerRequestId" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "providerStatus" TEXT,
    "status" "VtuOrderStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "WalletCurrency" NOT NULL,
    "targetMasked" TEXT,
    "costAmount" DECIMAL(15,2),
    "fee" DECIMAL(15,2),
    "margin" DECIMAL(15,2),
    "rawResponse" JSONB,
    "metadata" JSONB,
    "requeryAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastRequeryAt" TIMESTAMP(3),
    "nextRequeryAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vtu_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vtu_orders_transactionId_key" ON "vtu_orders"("transactionId");

CREATE UNIQUE INDEX "vtu_orders_provider_providerRequestId_key" ON "vtu_orders"("provider", "providerRequestId");

CREATE INDEX "vtu_orders_provider_status_idx" ON "vtu_orders"("provider", "status");

CREATE INDEX "vtu_orders_status_nextRequeryAt_idx" ON "vtu_orders"("status", "nextRequeryAt");

CREATE INDEX "vtu_orders_countryCode_serviceType_idx" ON "vtu_orders"("countryCode", "serviceType");

ALTER TABLE "vtu_orders" ADD CONSTRAINT "vtu_orders_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
