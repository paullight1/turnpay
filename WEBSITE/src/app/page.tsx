import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/landing-page";
import { MarketingShell } from "@/components/marketing/marketing-shell";

const description =
  "Exchange Nigerian naira to Ghanaian cedis with TrustPay. Get a clear NGN to GHS quote, transparent fees, secure settlement, and a receipt.";

export const metadata: Metadata = {
  title: "Naira to Cedi Exchange — Secure NGN to GHS Quotes",
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: "Naira to Cedi Exchange — Secure NGN to GHS Quotes",
    description,
    siteName: "TrustPay",
    url: "/",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Exchange Nigerian naira to Ghanaian cedis with TrustPay",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Naira to Cedi Exchange — Secure NGN to GHS Quotes",
    description,
    images: ["/twitter-image"],
  },
};

export default function HomePage() {
  return (
    <MarketingShell>
      <LandingPage />
    </MarketingShell>
  );
}
