-- CreateEnum
CREATE TYPE "ManualExchangeSettlement" AS ENUM ('WALLET', 'BANK', 'MOMO');

-- CreateEnum
CREATE TYPE "ManualExchangeStatus" AS ENUM ('AWAITING_TRANSFER', 'AWAITING_CONFIRMATION', 'NEEDS_MORE_INFO', 'REJECTED', 'CREDITED', 'PAYOUT_PENDING', 'PAYOUT_PROCESSING', 'PAYOUT_SENT', 'COMPLETED');

-- CreateTable
CREATE TABLE "manual_exchange_orders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "createKeyHash" TEXT NOT NULL,
    "createRequestHash" TEXT NOT NULL,
    "settlementMode" "ManualExchangeSettlement" NOT NULL,
    "status" "ManualExchangeStatus" NOT NULL DEFAULT 'AWAITING_TRANSFER',
    "version" INTEGER NOT NULL DEFAULT 0,
    "sourceCurrency" "WalletCurrency" NOT NULL DEFAULT 'NGN',
    "targetCurrency" "WalletCurrency" NOT NULL DEFAULT 'GHS',
    "amount" DECIMAL(15,2) NOT NULL,
    "targetAmount" DECIMAL(15,2) NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "fee" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "collectionAccount" JSONB NOT NULL,
    "destinationInstitution" TEXT,
    "destinationAccount" TEXT,
    "destinationName" TEXT,
    "proofKey" TEXT,
    "bankReference" TEXT,
    "depositReference" TEXT,
    "payoutReference" TEXT,
    "payoutProofKey" TEXT,
    "payoutClaimedBy" TEXT,
    "reviewReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_exchange_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_exchange_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "ManualExchangeStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_exchange_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_exchange_proofs" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_exchange_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_deposit_allocations" (
    "reference" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_deposit_allocations_pkey" PRIMARY KEY ("reference")
);

-- CreateIndex
CREATE UNIQUE INDEX "manual_exchange_orders_transactionId_key" ON "manual_exchange_orders"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "manual_exchange_orders_reference_key" ON "manual_exchange_orders"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "manual_exchange_orders_depositReference_key" ON "manual_exchange_orders"("depositReference");

-- CreateIndex
CREATE UNIQUE INDEX "manual_exchange_orders_payoutReference_key" ON "manual_exchange_orders"("payoutReference");

-- CreateIndex
CREATE INDEX "manual_exchange_orders_userId_createdAt_idx" ON "manual_exchange_orders"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "manual_exchange_orders_status_createdAt_idx" ON "manual_exchange_orders"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "manual_exchange_orders_userId_createKeyHash_key" ON "manual_exchange_orders"("userId", "createKeyHash");

-- CreateIndex
CREATE INDEX "manual_exchange_events_orderId_createdAt_idx" ON "manual_exchange_events"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "manual_exchange_events_orderId_actorId_action_keyHash_key" ON "manual_exchange_events"("orderId", "actorId", "action", "keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "manual_exchange_proofs_objectKey_key" ON "manual_exchange_proofs"("objectKey");

-- CreateIndex
CREATE INDEX "manual_exchange_proofs_orderId_kind_idx" ON "manual_exchange_proofs"("orderId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_deposit_allocations_settlementId_key" ON "exchange_deposit_allocations"("settlementId");

-- AddForeignKey
ALTER TABLE "manual_exchange_orders" ADD CONSTRAINT "manual_exchange_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_exchange_orders" ADD CONSTRAINT "manual_exchange_orders_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_exchange_events" ADD CONSTRAINT "manual_exchange_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "manual_exchange_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_exchange_proofs" ADD CONSTRAINT "manual_exchange_proofs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "manual_exchange_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defense in depth: these server-owned financial records are not a public Data API.
ALTER TABLE "manual_exchange_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manual_exchange_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manual_exchange_proofs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exchange_deposit_allocations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "manual_exchange_orders" ADD CONSTRAINT "manual_exchange_amounts_positive"
 CHECK ("amount" > 0 AND "targetAmount" > 0 AND "rate" > 0 AND "fee" >= 0);
ALTER TABLE "manual_exchange_orders" ADD CONSTRAINT "manual_exchange_settlement_mode"
 CHECK (("settlementMode" = 'WALLET' AND "destinationAccount" IS NULL AND "destinationInstitution" IS NULL AND "destinationName" IS NULL)
 OR ("settlementMode" IN ('BANK', 'MOMO') AND "destinationAccount" IS NOT NULL AND "destinationInstitution" IS NOT NULL AND "destinationName" IS NOT NULL));
ALTER TABLE "manual_exchange_orders" ADD CONSTRAINT "manual_exchange_exclusive_terminal"
 CHECK (("status" <> 'CREDITED' OR ("settlementMode" = 'WALLET' AND "payoutReference" IS NULL))
 AND ("status" NOT IN ('PAYOUT_PENDING','PAYOUT_PROCESSING','PAYOUT_SENT','COMPLETED') OR "settlementMode" <> 'WALLET'));
ALTER TABLE "manual_exchange_proofs" ADD CONSTRAINT "manual_exchange_proof_size" CHECK ("fileSize" BETWEEN 1 AND 8388608);
ALTER TABLE "exchange_deposit_allocations" ADD CONSTRAINT "exchange_deposit_amount_positive" CHECK ("amount" > 0);
