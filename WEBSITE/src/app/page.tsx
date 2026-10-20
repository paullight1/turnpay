import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/simple-landing-page";

const description =
  "Pay bills and buy airtime and data with TrustPay, a simple payments app made for everyday life in Nigeria. Coming soon.";

export const metadata: Metadata = {
  title: "TrustPay — Everyday Payments Made Simple",
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: "TrustPay — Everyday Payments Made Simple",
    description,
    siteName: "TrustPay",
    url: "/",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "TrustPay makes everyday payments simple in Nigeria",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "TrustPay — Everyday Payments Made Simple",
    description,
    images: ["/twitter-image"],
  },
};

export default function HomePage() {
  return <LandingPage />;
}
