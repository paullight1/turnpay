ALTER TABLE "vtu_orders"
ADD COLUMN "providerCommission" DECIMAL(15,2),
ADD COLUMN "purchasedCodeEncrypted" TEXT;

CREATE TABLE "vtu_webhook_inbox" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "providerRequestId" TEXT NOT NULL,
  "providerTransactionId" TEXT,
  "providerStatus" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vtu_webhook_inbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vtu_webhook_inbox_eventKey_key"
ON "vtu_webhook_inbox"("eventKey");

CREATE INDEX "vtu_webhook_inbox_processedAt_nextAttemptAt_idx"
ON "vtu_webhook_inbox"("processedAt", "nextAttemptAt");

CREATE INDEX "vtu_webhook_inbox_providerRequestId_idx"
ON "vtu_webhook_inbox"("providerRequestId");

ALTER TABLE "vtu_webhook_inbox" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "vtu_webhook_inbox" FROM anon, authenticated;
