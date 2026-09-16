BEGIN;

ALTER TABLE "transactions"
ADD COLUMN "exchangeQuoteId" TEXT;

-- Preserve replay protection for exchanges committed before this deployment.
-- Existing duplicate quote IDs intentionally fail the unique index below so
-- operators reconcile them before enabling the new execution path.
UPDATE "transactions"
SET "exchangeQuoteId" = "metadata"->>'quoteId'
WHERE "type" = 'EXCHANGE'
  AND jsonb_typeof("metadata"->'quoteId') = 'string'
  AND length("metadata"->>'quoteId') > 0;

CREATE UNIQUE INDEX "transactions_exchangeQuoteId_key"
ON "transactions"("exchangeQuoteId");

-- During a rolling deployment, older application instances still write only
-- metadata.quoteId. Populate the durable key for those writers as well.
CREATE FUNCTION enforce_exchange_quote_execution() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."type" = 'EXCHANGE'
    AND jsonb_typeof(NEW."metadata"->'quoteId') = 'string'
    AND length(NEW."metadata"->>'quoteId') > 0 THEN
    IF NEW."exchangeQuoteId" IS NULL THEN
      NEW."exchangeQuoteId" := NEW."metadata"->>'quoteId';
    ELSIF NEW."exchangeQuoteId" <> NEW."metadata"->>'quoteId' THEN
      RAISE EXCEPTION 'Exchange quote identity mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_exchange_quote_execution
BEFORE INSERT OR UPDATE OF "metadata", "exchangeQuoteId", "type"
ON "transactions"
FOR EACH ROW EXECUTE FUNCTION enforce_exchange_quote_execution();

COMMIT;
