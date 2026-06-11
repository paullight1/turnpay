CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'PAID', 'VOIDED');

ALTER TABLE "users"
ADD COLUMN "referralCode" TEXT,
ADD COLUMN "referredById" TEXT;

CREATE TABLE "referral_rewards" (
  "id" TEXT NOT NULL,
  "referrerId" TEXT NOT NULL,
  "referredUserId" TEXT NOT NULL,
  "referralCode" TEXT NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL DEFAULT 100,
  "currency" "WalletCurrency" NOT NULL DEFAULT 'NGN',
  "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
  "eligibleAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");
CREATE INDEX "users_referredById_idx" ON "users"("referredById");
CREATE UNIQUE INDEX "referral_rewards_referredUserId_key" ON "referral_rewards"("referredUserId");
CREATE INDEX "referral_rewards_referrerId_status_idx" ON "referral_rewards"("referrerId", "status");
CREATE INDEX "referral_rewards_referralCode_idx" ON "referral_rewards"("referralCode");

ALTER TABLE "users"
ADD CONSTRAINT "users_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "referral_rewards"
ADD CONSTRAINT "referral_rewards_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_rewards"
ADD CONSTRAINT "referral_rewards_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
