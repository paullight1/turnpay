import type { KycStatusOverview, User } from "@/types";
import { canonicalizeMoneyAmount } from "./money";

export type MoneyActionGate = {
  title: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
};

export type GateUser =
  | (Pick<User, "id" | "kycStatus" | "isSuspended" | "kycTier"> & {
      providerValidationStatus?: string;
    })
  | null
  | undefined;

export type MoneyActionOptions = {
  overview?: KycStatusOverview;
  amount?: string;
  action?: string;
  currency?: string;
};

/** Only server-supported tiers grant access; retain legacy numeric payloads. */
export function kycTierRank(value: unknown): number {
  const match = /^(?:TIER_)?([0-3])$/.exec(
    String(value ?? "")
      .trim()
      .toUpperCase(),
  );
  return match ? Number(match[1]) : 0;
}

/** Explanatory only. The backend rechecks eligibility and limits on mutation. */
export function getMoneyActionGate(
  profile: GateUser,
  options: MoneyActionOptions = {},
): MoneyActionGate | null {
  const { overview } = options;
  const user =
    profile && overview
      ? {
          ...profile,
          ...overview,
          isSuspended: overview.isSuspended ?? profile.isSuspended,
        }
      : profile;
  if (!user) return null;

  if (user?.isSuspended) {
    return {
      title: "Account suspended",
      message:
        "Money actions are disabled while your account is under review. Contact support if you need help.",
      actionLabel: "Contact support",
      actionHref: "/dashboard/support",
    };
  }

  const tier = kycTierRank(user.kycTier);
  if (user.kycStatus !== "VERIFIED" || tier < 1) {
    const pending =
      user.kycStatus === "SUBMITTED" ||
      user.providerValidationStatus === "PENDING";
    return {
      title: pending
        ? "Your BVN check is in progress"
        : "Verify BVN to continue",
      message: pending
        ? "View your verification status. Your transaction has not been submitted."
        : "Activate Tier 1 to send, withdraw, pay bills and exchange within your account limits.",
      actionLabel: pending ? "View verification status" : "Verify BVN",
      actionHref: "/dashboard/kyc",
    };
  }

  if (tier === 1 && overview && overview.tierOneLimits !== undefined) {
    const policy = overview.tierOneLimits;
    const readAmount = (value: unknown) =>
      typeof value === "string" ? canonicalizeMoneyAmount(value) : null;
    const limit = readAmount(policy?.perTransaction);
    const daily = readAmount(policy?.daily);
    const balance = readAmount(policy?.maxBalance);
    if (
      !policy ||
      policy.currency !== "NGN" ||
      !limit ||
      !daily ||
      !balance ||
      BigInt(daily.replace(".", "")) < BigInt(limit.replace(".", ""))
    ) {
      return {
        title: "Transactions temporarily unavailable",
        message:
          "Your Tier 1 limits are being configured. Please try again later or contact support.",
        actionLabel: "Contact support",
        actionHref: "/dashboard/support",
      };
    }
    const amount = options.amount && canonicalizeMoneyAmount(options.amount);
    if (
      options.action !== "fund" &&
      amount &&
      (options.currency ?? "NGN") === "NGN" &&
      BigInt(amount.replace(".", "")) > BigInt(limit.replace(".", ""))
    ) {
      return {
        title: "Your Tier 1 limit",
        message: `Your limit is NGN ${limit} per transaction. Use a smaller amount or upgrade to Tier 2.`,
        actionLabel: "Upgrade to Tier 2",
        actionHref: "/dashboard/kyc",
      };
    }
  }

  return null;
}
