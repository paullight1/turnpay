CREATE TABLE "vtu_pricing_rules" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT,
    "serviceType" "TransactionType",
    "provider" TEXT,
    "scope" "VtuOrderScope",
    "fixedMargin" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "percentMargin" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "minAmount" DECIMAL(15,2),
    "maxAmount" DECIMAL(15,2),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vtu_pricing_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vtu_pricing_rules_active_priority_idx" ON "vtu_pricing_rules"("isActive", "priority");
CREATE INDEX "vtu_pricing_rules_match_idx" ON "vtu_pricing_rules"("countryCode", "serviceType", "provider", "scope", "isActive");
CREATE INDEX "vtu_pricing_rules_service_scope_idx" ON "vtu_pricing_rules"("serviceType", "scope", "isActive");
