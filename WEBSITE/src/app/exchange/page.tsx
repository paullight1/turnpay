import type { Metadata } from "next";
import Image from "next/image";
import {
  ArrowLeftRight,
  ArrowRight,
  BadgeCheck,
  Clock3,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { PageHero } from "@/components/marketing/page-hero";
import { SectionHeading } from "@/components/marketing/section-heading";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { marketingImages } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Exchange Naira to Cedis | NGN to GHS Rates",
  description:
    "Exchange Nigerian naira to Ghanaian cedis with TrustPay. See a clear NGN to GHS rate, transparent fee, final amount, and receipt before you continue.",
  keywords: [
    "naira to cedis",
    "NGN to GHS",
    "Nigerian naira to Ghanaian cedi",
    "naira cedi exchange rate",
    "send money Nigeria to Ghana",
  ],
  alternates: { canonical: "/exchange" },
  openGraph: {
    type: "website",
    title: "Exchange Naira to Cedis | NGN to GHS Rates",
    description:
      "Get a clear NGN to GHS quote with transparent fees and a receipt from TrustPay.",
    url: "/exchange",
    siteName: "TrustPay",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "TrustPay Naira to Cedi exchange",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Exchange Naira to Cedis | NGN to GHS Rates",
    description:
      "Get a clear NGN to GHS quote with transparent fees and a receipt from TrustPay.",
    images: ["/twitter-image"],
  },
};

const whatsappExchangeUrl =
  "https://wa.me/233555507240?text=Hello%20TrustPay%2C%20I%20want%20to%20start%20an%20NGN%20to%20GHS%20exchange.";

const exchangeSteps = [
  {
    icon: ArrowLeftRight,
    title: "Send your request",
    description: "Tell us the amount and whether it is NGN to GHS or GHS to NGN.",
  },
  {
    icon: Clock3,
    title: "Get a clear rate",
    description: "We share the rate, fee, and amount before you continue.",
  },
  {
    icon: BadgeCheck,
    title: "Confirm details",
    description: "Check the name, amount, wallet, and final value first.",
  },
  {
    icon: ReceiptText,
    title: "Keep your proof",
    description: "Use your receipt and reference to track the exchange.",
  },
];

export default function ExchangePage() {
  return (
    <MarketingShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FinancialProduct",
            name: "TrustPay Naira to Cedi Exchange",
            description:
              "Exchange Nigerian naira to Ghanaian cedis with a clear quote, transparent fees, and secure settlement.",
            url: "https://trustpay.xyz/exchange",
            provider: {
              "@type": "Organization",
              name: "TrustPay",
              url: "https://trustpay.xyz",
            },
            areaServed: ["Nigeria", "Ghana"],
            feesAndCommissionsSpecification: "Fees are shown before confirmation.",
          }),
        }}
      />
      <PageHero
        eyebrow="Exchange"
        title="Exchange Naira to Cedis with TrustPay."
        description="Start your NGN to GHS exchange on WhatsApp. We help you see the rate, amount, and payment proof clearly."
      >
        <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
          <a href={whatsappExchangeUrl} target="_blank" rel="noreferrer">
            Start exchange
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </a>
        </Button>
      </PageHero>

      <section className="bg-[#0a0d0b] px-4 py-20 text-white sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div className="relative min-h-[480px] overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.05] trustpay-focus-card">
            <Image
              src={marketingImages.exchangeApp.src}
              alt={marketingImages.exchangeApp.alt}
              fill
              sizes="(min-width: 1024px) 46vw, 100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(5,6,5,0.82))]" />
          </div>

          <div className="flex flex-col gap-8">
            <SectionHeading
              eyebrow="How exchange works"
              title="Simple, clear, and direct."
              description="TrustPay keeps the exchange path easy to understand from first message to final receipt."
              tone="dark"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {exchangeSteps.map((step) => {
                const Icon = step.icon;

                return (
                  <Card key={step.title} className="rounded-lg">
                    <CardHeader>
                      <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                        <Icon aria-hidden="true" className="size-5" />
                      </div>
                      <CardTitle>{step.title}</CardTitle>
                      <CardDescription>{step.description}</CardDescription>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 rounded-[1.25rem] border border-red-400/25 bg-[linear-gradient(135deg,rgba(220,38,38,0.22),rgba(255,255,255,0.04),rgba(0,0,0,0.42))] p-8 text-white md:p-12">
          <ShieldCheck aria-hidden="true" className="size-10 text-red-400" />
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="max-w-3xl">
              <h2 className="text-3xl font-semibold leading-tight text-balance md:text-5xl">
                Keep your exchange details safe.
              </h2>
              <p className="mt-4 text-base leading-7 text-white/64">
                TrustPay support will not ask for your password, OTP, full card
                details, or transaction PIN. Share only the amount, currency,
                and transaction reference.
              </p>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
