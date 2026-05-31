import type { User } from "@/types";

export type MoneyActionGate = {
  title: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
};

type GateUser = Pick<User, "kycStatus" | "isSuspended"> | null | undefined;

export function getMoneyActionGate(user: GateUser): MoneyActionGate | null {
  if (!user) return null;

  if (user?.isSuspended) {
    return {
      title: "Account suspended",
      message: "Money actions are disabled while your account is under review. Contact support if you need help.",
      actionLabel: "Contact support",
      actionHref: "/dashboard/support",
    };
  }

  if (user?.kycStatus !== "VERIFIED") {
    return {
      title: "KYC verification required",
      message: "Complete KYC verification before funding, withdrawing, exchanging, or buying services.",
      actionLabel: "Review KYC",
      actionHref: "/dashboard/kyc",
    };
  }

  return null;
}
