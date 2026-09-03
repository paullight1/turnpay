ALTER TABLE "kyc_verifications"
ADD COLUMN "consentRecordedAt" TIMESTAMP(3),
ADD COLUMN "consentVersion" VARCHAR(64),
ADD COLUMN "consentSource" VARCHAR(32);

CREATE UNIQUE INDEX "kyc_documents_active_user_type_key"
ON "kyc_documents" ("userId", "type")
WHERE "status" IN ('PENDING', 'SUBMITTED');

CREATE TABLE "kyc_webhook_inbox" (
  "id" TEXT NOT NULL,
  "provider" "KycVerificationProvider" NOT NULL,
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
  CONSTRAINT "kyc_webhook_inbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kyc_webhook_inbox_replay_key"
ON "kyc_webhook_inbox" ("provider", "providerReference", "eventType", "payloadHash");

CREATE INDEX "kyc_webhook_inbox_status_nextAttemptAt_idx"
ON "kyc_webhook_inbox" ("status", "nextAttemptAt");

CREATE INDEX "kyc_webhook_inbox_providerReference_idx"
ON "kyc_webhook_inbox" ("providerReference");
