-- Transactional account-status mail is server-owned durable work. The row
-- stores only stable event metadata; the recipient and rendered body are
-- resolved from users at dispatch time.
CREATE TYPE "EmailOutboxStatus" AS ENUM (
  'PENDING',
  'IN_FLIGHT',
  'SENT',
  'FAILED',
  'EXHAUSTED',
  'UNKNOWN'
);

CREATE TABLE "email_outbox" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "status" "EmailOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "claimToken" TEXT,
  "sentAt" TIMESTAMP(3),
  "unknownAt" TIMESTAMP(3),
  "exhaustedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "providerMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_outbox_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "email_outbox_eventKey_key"
  ON "email_outbox"("eventKey");
CREATE INDEX "email_outbox_due_idx"
  ON "email_outbox"("status", "nextAttemptAt");
CREATE INDEX "email_outbox_userId_createdAt_idx"
  ON "email_outbox"("userId", "createdAt" DESC);

-- Email events are accessed only by the backend worker. Keep them private
-- from Supabase Data API roles, including future browser clients.
ALTER TABLE "email_outbox" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "email_outbox" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "email_outbox" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "email_outbox" FROM authenticated;
  END IF;
END $$;
