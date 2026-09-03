CREATE TABLE "internal_transfer_limit_policies" (
    "id" TEXT NOT NULL,
    "currency" "WalletCurrency" NOT NULL,
    "kycTier" "KYCTier" NOT NULL,
    "perTransaction" DECIMAL(15,2) NOT NULL,
    "daily" DECIMAL(15,2) NOT NULL,
    "monthly" DECIMAL(15,2) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL,
    "requestedById" TEXT,
    "approvedById" TEXT,
    "reason" TEXT NOT NULL,
    "approvalReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_transfer_limit_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "internal_transfer_limit_policies_positive_limits_check"
      CHECK ("perTransaction" > 0 AND "daily" > 0 AND "monthly" > 0),
    CONSTRAINT "internal_transfer_limit_policies_ordered_limits_check"
      CHECK ("perTransaction" <= "daily" AND "daily" <= "monthly")
);

CREATE INDEX "internal_transfer_limit_policies_currency_kycTier_enabled_e_idx"
ON "internal_transfer_limit_policies"("currency", "kycTier", "enabled", "effectiveFrom");

CREATE INDEX "internal_transfer_limit_policies_requestedById_createdAt_idx"
ON "internal_transfer_limit_policies"("requestedById", "createdAt");

CREATE INDEX "internal_transfer_limit_policies_approvedById_approvedAt_idx"
ON "internal_transfer_limit_policies"("approvedById", "approvedAt");

CREATE UNIQUE INDEX "internal_transfer_limit_policies_currency_kycTier_version_key"
ON "internal_transfer_limit_policies"("currency", "kycTier", "version");

-- PostgreSQL, not application timing, guarantees one active policy per scope.
CREATE UNIQUE INDEX "internal_transfer_limit_policies_one_active_per_scope"
ON "internal_transfer_limit_policies"("currency", "kycTier")
WHERE "enabled" = true;

-- Seed every scope disabled. NGN mirrors the previous code constants for review;
-- GHS uses a one-minor-unit placeholder and must be superseded before approval.
INSERT INTO "internal_transfer_limit_policies" (
  "id", "currency", "kycTier", "perTransaction", "daily", "monthly",
  "enabled", "version", "reason", "effectiveFrom", "updatedAt"
)
VALUES
  ('00000000-0000-4000-8000-000000000201', 'NGN', 'TIER_2', 250000.00, 1000000.00, 5000000.00, false, 1, 'Seeded from legacy limits; awaiting recorded Risk and Compliance approval', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000301', 'NGN', 'TIER_3', 1000000.00, 5000000.00, 20000000.00, false, 1, 'Seeded from legacy limits; awaiting recorded Risk and Compliance approval', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000202', 'GHS', 'TIER_2', 0.01, 0.01, 0.01, false, 1, 'Placeholder only; create a reviewed policy version before approval', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000302', 'GHS', 'TIER_3', 0.01, 0.01, 0.01, false, 1, 'Placeholder only; create a reviewed policy version before approval', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "internal_transfer_limit_policies" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "internal_transfer_limit_policies" FROM anon, authenticated;
