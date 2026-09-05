ALTER TABLE "manual_exchange_proofs" ADD COLUMN "uploadKeyHash" TEXT;
ALTER TABLE "manual_exchange_proofs" ADD COLUMN "uploadRequestHash" TEXT;
CREATE UNIQUE INDEX "manual_exchange_proofs_orderId_actorId_kind_uploadKeyHash_key"
ON "manual_exchange_proofs" ("orderId", "actorId", "kind", "uploadKeyHash");
