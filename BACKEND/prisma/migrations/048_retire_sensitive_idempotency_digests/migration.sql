-- The former global body fingerprint included PINs/OTPs and passwords in an
-- unkeyed SHA256 digest. Retire these digests without deleting durable replay
-- rows or responses: an old retry fails closed instead of redispatching money.
-- New hashes are domain/version prefixed (business:v2: or hmac:).
UPDATE "idempotency_records"
SET "requestHash" = 'legacy-retired:' || "id",
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "requestHash" ~ '^[a-f0-9]{64}$';
