import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/landing-page";
import { MarketingShell } from "@/components/marketing/marketing-shell";

const description =
  "TrustPay is a secure platform for multi-currency wallets, transfers, bill payments, and currency exchange.";

export const metadata: Metadata = {
  title: "TrustPay — Secure wallets, transfers & bill payments",
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: "TrustPay — Secure wallets, transfers & bill payments",
    description,
    siteName: "TrustPay",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "TrustPay — Secure wallets, transfers & bill payments",
    description,
  },
};

export default function HomePage() {
  return (
    <MarketingShell>
      <LandingPage />
    </MarketingShell>
  );
}
