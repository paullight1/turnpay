ALTER TABLE "funding_adverse_cases"
    ADD COLUMN "economicReference" TEXT;

CREATE INDEX "funding_adverse_cases_provider_economic_idx"
    ON "funding_adverse_cases"("provider", "economicReference");

CREATE INDEX "funding_adverse_cases_provider_funding_idx"
    ON "funding_adverse_cases"("provider", "fundingReference", "eventType", "verificationStatus");

ALTER TABLE "funding_adverse_cases"
    ADD CONSTRAINT "funding_adverse_cases_money_check"
    CHECK (
      "recoveredAmount" >= 0
      AND ("exposureAmount" IS NULL OR "exposureAmount" > 0)
      AND ("exposureAmount" IS NULL OR "recoveredAmount" <= "exposureAmount")
    );

-- This is a server-only financial/audit table. Browser/mobile Data API roles
-- must not read or write it; all access is mediated by the NestJS API.
ALTER TABLE "funding_adverse_cases" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "funding_adverse_cases" FROM anon, authenticated;
