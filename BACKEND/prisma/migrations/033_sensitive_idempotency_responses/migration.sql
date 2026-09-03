ALTER TABLE "idempotency_records"
ADD COLUMN "encryptionKeyId" VARCHAR(64),
ADD COLUMN "responseCiphertext" TEXT,
ADD COLUMN "responseIv" VARCHAR(32),
ADD COLUMN "responseTag" VARCHAR(32);

ALTER TABLE "transaction_pin_credentials"
ADD COLUMN "pinLength" INTEGER;

ALTER TABLE "transaction_pin_credentials"
ADD CONSTRAINT "transaction_pin_credentials_pin_length_check"
CHECK ("pinLength" IS NULL OR "pinLength" BETWEEN 4 AND 6);

ALTER TABLE "idempotency_records"
ADD CONSTRAINT "idempotency_records_encrypted_response_complete_check"
CHECK (
  ("responseCiphertext" IS NULL AND "responseIv" IS NULL AND "responseTag" IS NULL AND "encryptionKeyId" IS NULL)
  OR
  ("responseCiphertext" IS NOT NULL AND "responseIv" IS NOT NULL AND "responseTag" IS NOT NULL AND "encryptionKeyId" IS NOT NULL)
);

-- Token-bearing auth responses may never fall back to the plaintext JSON
-- response column. The application supplies AES-256-GCM ciphertext instead.
ALTER TABLE "idempotency_records"
ADD CONSTRAINT "idempotency_records_token_response_encrypted_check"
CHECK (
  "status" <> 'COMPLETED'
  OR "path" NOT IN ('/api/auth/register', '/api/auth/login', '/api/auth/refresh')
  OR (
    "response" IS NULL
    AND "responseCiphertext" IS NOT NULL
    AND "responseIv" IS NOT NULL
    AND "responseTag" IS NOT NULL
    AND "encryptionKeyId" IS NOT NULL
  )
);
