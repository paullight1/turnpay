CREATE TABLE "transaction_pin_credentials" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "salt" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "iterations" INTEGER NOT NULL,
  "resetHoldUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transaction_pin_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "transaction_pin_credentials_userId_key"
ON "transaction_pin_credentials"("userId");

CREATE INDEX "transaction_pin_credentials_resetHoldUntil_idx"
ON "transaction_pin_credentials"("resetHoldUntil");

ALTER TABLE "transaction_pin_credentials"
ADD CONSTRAINT "transaction_pin_credentials_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PIN hashes are server-only credentials and must never be exposed through
-- Supabase's anon/authenticated Data API roles.
ALTER TABLE "transaction_pin_credentials" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "transaction_pin_credentials" FROM anon, authenticated;
