ALTER TABLE "vtu_orders" ADD COLUMN "actionRequiredAt" TIMESTAMP(3);
CREATE INDEX "vtu_orders_escalation_idx" ON "vtu_orders"("status", "actionRequiredAt", "requeryAttempts", "createdAt");
-- Existing exhausted orders are intentionally left NULL: the bounded backfill
-- worker will create/reuse their unique alert and mark each as escalated once.
