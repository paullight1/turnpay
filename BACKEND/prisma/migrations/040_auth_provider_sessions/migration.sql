-- Bind each application refresh-token record to the Supabase Auth session
-- represented by the provider access token's verified session_id claim.
-- Existing rows remain NULL and are re-bound when their refresh token rotates;
-- protected provider-token requests fail closed until that happens.
ALTER TABLE "refresh_tokens"
ADD COLUMN "providerSessionId" TEXT;

CREATE INDEX "refresh_tokens_providerSessionId_revokedAt_expiresAt_idx"
ON "refresh_tokens"("providerSessionId", "revokedAt", "expiresAt");
