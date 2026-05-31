-- CreateEnum
CREATE TYPE "KYCTier" AS ENUM ('TIER_0', 'TIER_1', 'TIER_2', 'TIER_3');

-- CreateEnum
CREATE TYPE "KycVerificationProvider" AS ENUM ('MANUAL_REVIEW', 'NIBSS', 'MONNIFY');

-- CreateEnum
CREATE TYPE "KycVerificationStatus" AS ENUM ('PENDING', 'REVIEW_REQUIRED', 'VERIFIED', 'REJECTED', 'FAILED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "kycTier" "KYCTier" NOT NULL DEFAULT 'TIER_0';

-- CreateTable
CREATE TABLE "kyc_verifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "provider" "KycVerificationProvider" NOT NULL,
    "status" "KycVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT NOT NULL,
    "checks" JSONB,
    "responseHash" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kyc_verifications_provider_reference_key" ON "kyc_verifications"("provider", "reference");

-- CreateIndex
CREATE INDEX "kyc_verifications_userId_status_idx" ON "kyc_verifications"("userId", "status");

-- CreateIndex
CREATE INDEX "kyc_verifications_documentId_idx" ON "kyc_verifications"("documentId");

-- CreateIndex
CREATE INDEX "kyc_verifications_provider_status_idx" ON "kyc_verifications"("provider", "status");

-- AddForeignKey
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "kyc_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
