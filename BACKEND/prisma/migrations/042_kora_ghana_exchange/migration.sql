-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'KORA';

-- CreateTable
CREATE TABLE "kora_account_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "claimedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kora_account_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kora_collection_intents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "WalletCurrency" NOT NULL DEFAULT 'GHS',
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "orderId" TEXT,
    "transactionId" TEXT,
    "mobileEncrypted" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "authorization" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kora_collection_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_exchange_quotes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceCurrency" "WalletCurrency" NOT NULL,
    "targetCurrency" "WalletCurrency" NOT NULL,
    "fundingSource" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "fee" DECIMAL(15,2) NOT NULL,
    "total" DECIMAL(15,2) NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "targetAmount" DECIMAL(15,2) NOT NULL,
    "destinationType" TEXT NOT NULL,
    "destinationCode" TEXT NOT NULL,
    "destinationName" TEXT NOT NULL,
    "destinationEncrypted" TEXT NOT NULL,
    "destinationMasked" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_exchange_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_exchange_orders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "createKeyHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "fundingReference" TEXT,
    "fundedAt" TIMESTAMP(3),
    "payoutReference" TEXT,
    "releasedBy" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_exchange_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_treasury_entries" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "currency" "WalletCurrency" NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_treasury_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_notifications" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'ADMIN',
    "orderId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_limit_usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" "WalletCurrency" NOT NULL,
    "day" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL DEFAULT 0,

    CONSTRAINT "currency_limit_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kora_account_requests_userId_key" ON "kora_account_requests"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "kora_account_requests_reference_key" ON "kora_account_requests"("reference");

-- CreateIndex
CREATE INDEX "kora_account_requests_status_updatedAt_idx" ON "kora_account_requests"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "kora_collection_intents_reference_key" ON "kora_collection_intents"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "kora_collection_intents_orderId_key" ON "kora_collection_intents"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "kora_collection_intents_transactionId_key" ON "kora_collection_intents"("transactionId");

-- CreateIndex
CREATE INDEX "kora_collection_intents_status_updatedAt_idx" ON "kora_collection_intents"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "kora_collection_intents_userId_createdAt_idx" ON "kora_collection_intents"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "provider_exchange_quotes_userId_expiresAt_idx" ON "provider_exchange_quotes"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_exchange_orders_quoteId_key" ON "provider_exchange_orders"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_exchange_orders_transactionId_key" ON "provider_exchange_orders"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_exchange_orders_fundingReference_key" ON "provider_exchange_orders"("fundingReference");

-- CreateIndex
CREATE UNIQUE INDEX "provider_exchange_orders_payoutReference_key" ON "provider_exchange_orders"("payoutReference");

-- CreateIndex
CREATE INDEX "provider_exchange_orders_status_createdAt_idx" ON "provider_exchange_orders"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_exchange_orders_userId_createKeyHash_key" ON "provider_exchange_orders"("userId", "createKeyHash");

-- CreateIndex
CREATE INDEX "exchange_treasury_entries_currency_createdAt_idx" ON "exchange_treasury_entries"("currency", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_treasury_entries_orderId_kind_key" ON "exchange_treasury_entries"("orderId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "payment_notifications_eventKey_key" ON "payment_notifications"("eventKey");

-- CreateIndex
CREATE INDEX "payment_notifications_audience_createdAt_idx" ON "payment_notifications"("audience", "createdAt");

-- CreateIndex
CREATE INDEX "currency_limit_usage_userId_currency_month_idx" ON "currency_limit_usage"("userId", "currency", "month");

-- CreateIndex
CREATE UNIQUE INDEX "currency_limit_usage_userId_currency_day_key" ON "currency_limit_usage"("userId", "currency", "day");

-- AddForeignKey
ALTER TABLE "kora_account_requests" ADD CONSTRAINT "kora_account_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kora_collection_intents" ADD CONSTRAINT "kora_collection_intents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kora_collection_intents" ADD CONSTRAINT "kora_collection_intents_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "provider_exchange_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kora_collection_intents" ADD CONSTRAINT "kora_collection_intents_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_exchange_quotes" ADD CONSTRAINT "provider_exchange_quotes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_exchange_orders" ADD CONSTRAINT "provider_exchange_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_exchange_orders" ADD CONSTRAINT "provider_exchange_orders_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "provider_exchange_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_exchange_orders" ADD CONSTRAINT "provider_exchange_orders_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_treasury_entries" ADD CONSTRAINT "exchange_treasury_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "provider_exchange_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_limit_usage" ADD CONSTRAINT "currency_limit_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Financial invariants also apply to non-HTTP callers.
ALTER TABLE "provider_exchange_quotes" ADD CONSTRAINT "provider_exchange_quote_money" CHECK ("amount" > 0 AND "fee" >= 0 AND "total" = "amount" + "fee" AND "rate" > 0 AND "targetAmount" > 0 AND "sourceCurrency" <> "targetCurrency" AND "fundingSource" IN ('WALLET', 'EXTERNAL'));
ALTER TABLE "kora_collection_intents" ADD CONSTRAINT "kora_collection_money_purpose" CHECK ("amount" > 0 AND "currency" = 'GHS' AND (("purpose" = 'EXCHANGE' AND "orderId" IS NOT NULL AND "transactionId" IS NULL) OR ("purpose" = 'WALLET' AND "orderId" IS NULL AND "transactionId" IS NOT NULL)));
ALTER TABLE "exchange_treasury_entries" ADD CONSTRAINT "exchange_treasury_positive" CHECK ("amount" > 0);
ALTER TABLE "currency_limit_usage" ADD CONSTRAINT "currency_limit_nonnegative" CHECK ("amount" >= 0);
ALTER TABLE "provider_exchange_orders" ADD CONSTRAINT "provider_exchange_order_state" CHECK ("status" IN ('AWAITING_PAYMENT', 'READY', 'PROCESSING', 'SENT', 'FAILED', 'REFUNDED', 'NEEDS_REVIEW'));
