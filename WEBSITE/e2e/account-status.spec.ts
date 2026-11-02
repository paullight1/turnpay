import { expect, test } from "@playwright/test";
import { getMoneyActionGate, type GateUser } from "../src/lib/account-status";
import type { KycStatusOverview } from "../src/types";

const verified = {
  id: "customer",
  kycStatus: "VERIFIED",
  kycTier: "TIER_1",
  isSuspended: false,
};
const overview: KycStatusOverview = {
  provider: "PAYSTACK",
  providerValidationStatus: "VERIFIED",
  kycStatus: "VERIFIED",
  kycTier: "TIER_1",
  documents: [],
  tierOneLimits: {
    currency: "NGN",
    perTransaction: "100.00",
    daily: "200.00",
    maxBalance: "300.00",
  },
};

test("unknown tiers do not unlock money actions or masquerade as an upgrade", () => {
  for (const kycTier of ["TIER_99", "TIER_-1", "invalid2", "", null]) {
    expect(getMoneyActionGate({ ...verified, kycTier })).not.toBeNull();
  }
});

test("supported legacy numeric tiers retain their transaction eligibility", () => {
  for (const kycTier of [1, 2, 3, "1", "TIER_2", "TIER_3"]) {
    expect(getMoneyActionGate({ ...verified, kycTier })).toBeNull();
  }
});

test("a fresh server suspension overrides an old verified profile", () => {
  expect(
    getMoneyActionGate(verified, {
      overview: { ...overview, isSuspended: true },
      amount: "100.01",
    }),
  ).toMatchObject({ actionHref: "/dashboard/support" });
});

test("Tier 1 exact amounts use the server cap and allow the boundary", () => {
  expect(
    getMoneyActionGate(verified, { overview, amount: "100.00" }),
  ).toBeNull();
  expect(
    getMoneyActionGate(verified, { overview, amount: "100.01" }),
  ).toMatchObject({ actionLabel: "Upgrade to Tier 2" });
});

test("fresh earned Tier 2 supersedes stale Tier 1 limits", () => {
  expect(
    getMoneyActionGate(verified, {
      overview: { ...overview, kycTier: "TIER_2", tierOneLimits: null },
      amount: "100.01",
    }),
  ).toBeNull();
});

test("missing or malformed explicit policies direct the customer to support", () => {
  for (const tierOneLimits of [
    null,
    { ...overview.tierOneLimits!, perTransaction: "NaN" },
  ]) {
    expect(
      getMoneyActionGate(verified, {
        overview: { ...overview, tierOneLimits },
      }),
    ).toMatchObject({ actionHref: "/dashboard/support" });
  }
});

test("old status payloads without policy fields remain compatible", () => {
  const { tierOneLimits: _limits, ...legacy } = overview;
  void _limits;
  expect(getMoneyActionGate(verified, { overview: legacy })).toBeNull();
});

test("a pending BVN uses a status action while pending NIN keeps Tier 1 active", () => {
  expect(
    getMoneyActionGate({
      ...verified,
      kycStatus: "SUBMITTED",
      kycTier: "TIER_0",
    }),
  ).toMatchObject({ actionLabel: "View verification status" });
  expect(getMoneyActionGate(verified as GateUser, { overview })).toBeNull();
});
