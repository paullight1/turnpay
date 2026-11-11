BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "manual_exchange_orders" ADD COLUMN "receiptName" TEXT;
COMMIT;
