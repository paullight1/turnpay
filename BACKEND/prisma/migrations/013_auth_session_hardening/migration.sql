ALTER TABLE "refresh_tokens"
  ADD COLUMN "deviceId" TEXT,
  ADD COLUMN "deviceName" TEXT,
  ADD COLUMN "userAgent" TEXT,
  ADD COLUMN "ipAddress" TEXT,
  ADD COLUMN "tokenHash" TEXT,
  ADD COLUMN "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "replacedByTokenId" TEXT;

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
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");
CREATE INDEX "refresh_tokens_userId_revokedAt_expiresAt_idx" ON "refresh_tokens"("userId", "revokedAt", "expiresAt");
CREATE INDEX "refresh_tokens_deviceId_idx" ON "refresh_tokens"("deviceId");
