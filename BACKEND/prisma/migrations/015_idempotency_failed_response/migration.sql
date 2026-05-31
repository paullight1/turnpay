ALTER TABLE "idempotency_records"
ADD COLUMN "httpStatus" INTEGER,
ADD COLUMN "errorResponse" JSONB;
