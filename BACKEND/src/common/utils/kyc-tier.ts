import { KYCTier } from "@prisma/client";

const KYC_TIER_RANK: Record<KYCTier, number> = {
  TIER_0: 0,
  TIER_1: 1,
  TIER_2: 2,
  TIER_3: 3,
};

export function isKycTierAtLeast(
  currentTier: KYCTier | null | undefined,
  minimumTier: KYCTier,
) {
  return KYC_TIER_RANK[currentTier ?? "TIER_0"] >= KYC_TIER_RANK[minimumTier];
}

export function formatKycTier(tier: KYCTier) {
  return tier.replace("TIER_", "Tier ");
}
