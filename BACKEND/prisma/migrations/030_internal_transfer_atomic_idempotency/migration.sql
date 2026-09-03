-- Persist a hashed business idempotency key and the exact committed response.
-- The raw Idempotency-Key is intentionally never stored.
ALTER TYPE "InternalTransferAttemptStatus" ADD VALUE 'PROCESSING';

ALTER TABLE "internal_transfer_attempts"
ADD COLUMN "idempotencyKeyHash" VARCHAR(64),
ADD COLUMN "ipAddress" VARCHAR(64),
ADD COLUMN "requestHash" VARCHAR(64),
ADD COLUMN "requestId" VARCHAR(128),
ADD COLUMN "response" JSONB,
ADD COLUMN "userAgent" VARCHAR(256);

CREATE INDEX "internal_transfer_attempts_requestId_idx"
ON "internal_transfer_attempts"("requestId");

CREATE UNIQUE INDEX "internal_transfer_attempts_user_idempotency_key"
ON "internal_transfer_attempts"("userId", "idempotencyKeyHash");

-- This remains a server-only financial table. Repeat the posture here so the
-- migration is safe even when applied to an environment with grant drift.
ALTER TABLE "internal_transfer_attempts" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "internal_transfer_attempts" FROM anon, authenticated;
