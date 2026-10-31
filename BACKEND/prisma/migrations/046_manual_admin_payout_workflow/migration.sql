-- Preserve historical manual workflows. New NGN→GHS external orders are explicitly marked by the server.
ALTER TABLE "manual_exchange_orders" ADD COLUMN "payoutWorkflow" TEXT NOT NULL DEFAULT 'LEGACY';
ALTER TABLE "manual_exchange_orders" ADD CONSTRAINT "manual_exchange_payout_workflow_check" CHECK ("payoutWorkflow" IN ('LEGACY', 'ADMIN_CEDIS'));
