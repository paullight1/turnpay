CREATE TABLE "payment_webhook_inbox" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "eventType" TEXT NOT NULL,
  "providerReference" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" "ProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_webhook_inbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_webhook_inbox_provider_event_reference_key"
ON "payment_webhook_inbox"("provider", "eventType", "providerReference");

CREATE INDEX "payment_webhook_inbox_provider_reference_idx"
ON "payment_webhook_inbox"("provider", "providerReference");

CREATE INDEX "payment_webhook_inbox_status_nextAttemptAt_idx"
ON "payment_webhook_inbox"("status", "nextAttemptAt");

CREATE INDEX "payment_webhook_inbox_status_claimedAt_idx"
ON "payment_webhook_inbox"("status", "claimedAt");
