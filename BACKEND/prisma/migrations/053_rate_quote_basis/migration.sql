-- Make the unit convention explicit without changing the numeric admin prices.
-- New rows remain target units per source unit unless an admin explicitly
-- chooses SOURCE_PER_TARGET. The two exact legacy admin rows below were entered
-- in source-per-target units and are marked accordingly; no quote/order rows
-- are rewritten.
BEGIN;

CREATE TYPE "RateQuoteBasis" AS ENUM ('TARGET_PER_SOURCE', 'SOURCE_PER_TARGET');

ALTER TABLE "rates"
  ADD COLUMN "quoteBasis" "RateQuoteBasis" NOT NULL DEFAULT 'TARGET_PER_SOURCE';

DO $$
DECLARE
  legacy_rate RECORD;
BEGIN
  FOR legacy_rate IN
    SELECT "id", "from", "to", "rate", "markup"
    FROM "rates"
    WHERE "source" = 'admin'
      AND (
        ("from" = 'NGN' AND "to" = 'GHS' AND "rate" = 87.0000)
        OR
        ("from" = 'GHS' AND "to" = 'NGN' AND "rate" = 0.0111)
      )
      AND "quoteBasis" = 'TARGET_PER_SOURCE'
  LOOP
    UPDATE "rates"
    SET "quoteBasis" = 'SOURCE_PER_TARGET'
    WHERE "id" = legacy_rate."id";

    INSERT INTO "audit_logs" (
      "id", "adminId", "action", "targetType", "targetId", "reason",
      "before", "after", "metadata", "createdAt"
    ) VALUES (
      gen_random_uuid()::text,
      NULL,
      'FX_RATE_UNIT_CORRECTION',
      'Rate',
      legacy_rate."id",
      'SYSTEM unit-correction: legacy admin quote basis marked explicitly',
      jsonb_build_object(
        'from', legacy_rate."from",
        'to', legacy_rate."to",
        'rate', legacy_rate."rate"::text,
        'markup', legacy_rate."markup"::text,
        'quoteBasis', 'TARGET_PER_SOURCE'
      ),
      jsonb_build_object(
        'from', legacy_rate."from",
        'to', legacy_rate."to",
        'rate', legacy_rate."rate"::text,
        'markup', legacy_rate."markup"::text,
        'quoteBasis', 'SOURCE_PER_TARGET'
      ),
      jsonb_build_object(
        'source', 'system',
        'reason', 'unit-correction',
        'legacyPair', legacy_rate."from" || '_' || legacy_rate."to"
      ),
      CURRENT_TIMESTAMP
    );
  END LOOP;
END $$;

COMMIT;
