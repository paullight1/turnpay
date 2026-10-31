-- Paystack customer validation and dedicated-account lifecycle state.
ALTER TYPE "KycVerificationProvider" ADD VALUE IF NOT EXISTS 'PAYSTACK';

CREATE TABLE "paystack_customers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerCode" TEXT NOT NULL,
    "customerId" TEXT,
    "validationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "validationFingerprint" TEXT,
    "accountSetupConsentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "paystack_customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "paystack_account_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consentRecordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "paystack_account_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "paystack_customers_userId_key" ON "paystack_customers"("userId");
CREATE UNIQUE INDEX "paystack_customers_customerCode_key" ON "paystack_customers"("customerCode");
CREATE INDEX "paystack_customers_validationStatus_idx" ON "paystack_customers"("validationStatus");
CREATE INDEX "paystack_customers_validationFingerprint_idx" ON "paystack_customers"("validationFingerprint");
CREATE UNIQUE INDEX "paystack_account_requests_userId_key" ON "paystack_account_requests"("userId");
CREATE INDEX "paystack_account_requests_status_nextAttemptAt_idx" ON "paystack_account_requests"("status", "nextAttemptAt");
CREATE INDEX "paystack_account_requests_customerCode_idx" ON "paystack_account_requests"("customerCode");

ALTER TABLE "paystack_customers"
  ADD CONSTRAINT "paystack_customers_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "paystack_account_requests"
  ADD CONSTRAINT "paystack_account_requests_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "webhook_logs_reference_key";
CREATE UNIQUE INDEX "webhook_logs_provider_event_reference_key"
  ON "webhook_logs"("provider", "eventType", "reference");

ALTER TABLE public.paystack_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paystack_account_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY paystack_customers_client_deny_all
  ON public.paystack_customers
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY paystack_account_requests_client_deny_all
  ON public.paystack_account_requests
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
