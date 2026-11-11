import type { ReactNode } from "react";
import { redirect } from "next/navigation";

export default function FundingReviewLayout({ children }: { children: ReactNode }) {
  if (process.env.TRUSTPAY_ADMIN_FUNDING_REVIEW !== "true") {
    redirect("/admin");
  }

  return children;
}
