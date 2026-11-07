-- Expand the workflow discriminator without changing any historical obligation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE "manual_exchange_orders"
  DROP CONSTRAINT "manual_exchange_payout_workflow_check",
  ADD CONSTRAINT "manual_exchange_payout_workflow_check"
  CHECK ("payoutWorkflow" IN ('LEGACY', 'ADMIN_CEDIS', 'ADMIN_EXTERNAL'));

COMMIT;
