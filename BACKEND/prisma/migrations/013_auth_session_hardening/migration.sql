ALTER TABLE "refresh_tokens"
  ADD COLUMN IF NOT EXISTS "deviceId" TEXT,
  ADD COLUMN IF NOT EXISTS "deviceName" TEXT,
  ADD COLUMN IF NOT EXISTS "userAgent" TEXT,
  ADD COLUMN IF NOT EXISTS "ipAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "replacedByTokenId" TEXT;

UPDATE "refresh_tokens"
  SET "deviceId" = "id"
  WHERE "deviceId" IS NULL;

UPDATE "refresh_tokens"
  SET "tokenHash" = "id"
  WHERE "tokenHash" IS NULL;

ALTER TABLE "refresh_tokens"
  ALTER COLUMN "tokenHash" SET NOT NULL,
  ALTER COLUMN "deviceId" SET NOT NULL;

DROP INDEX IF EXISTS "refresh_tokens_tokenHash_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");
CREATE INDEX IF NOT EXISTS "refresh_tokens_userId_revokedAt_expiresAt_idx" ON "refresh_tokens"("userId", "revokedAt", "expiresAt");
CREATE INDEX IF NOT EXISTS "refresh_tokens_deviceId_idx" ON "refresh_tokens"("deviceId");
