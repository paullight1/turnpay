-- These tables were introduced after the initial Supabase RLS migration.
-- All access is mediated by the NestJS API; browser/mobile Data API roles get
-- no direct privileges or policies on financial, provider, or audit records.
ALTER TABLE "referral_rewards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exchange_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exchange_payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "internal_transfer_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "internal_transfer_limit_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "virtual_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_webhook_inbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transfer_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vtu_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vtu_pricing_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kyc_verifications" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  "referral_rewards",
  "exchange_receipts",
  "exchange_payouts",
  "ledger_entries",
  "internal_transfer_attempts",
  "internal_transfer_limit_usage",
  "idempotency_records",
  "virtual_accounts",
  "bank_accounts",
  "provider_events",
  "payment_webhook_inbox",
  "reconciliation_runs",
  "transfer_attempts",
  "vtu_orders",
  "vtu_pricing_rules",
  "audit_logs",
  "rate_overrides",
  "rate_alerts",
  "kyc_verifications"
FROM anon, authenticated;

-- Keep future Prisma-created tables/functions private by default. Public Data
-- API exposure must be an explicit migration with matching RLS policies.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
REVOKE USAGE, SELECT ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
