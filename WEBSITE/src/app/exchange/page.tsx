import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
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
  title: "Exchange NGN and GHS | TrustPay",
  description:
    "Exchange Nigerian naira and Ghanaian cedis with a clear quote, visible rate, and receipt.",
};

const exchangeSteps = [
  {
    icon: ArrowLeftRight,
    title: "Choose the pair",
    description: "Pick NGN to GHS or GHS to NGN.",
  },
  {
    icon: Clock3,
    title: "Check the quote",
    description: "See the rate, fee, and amount before approval.",
  },
  {
    icon: BadgeCheck,
    title: "Approve safely",
    description: "Confirm only when the details look right.",
  },
  {
    icon: ReceiptText,
    title: "Track the receipt",
    description: "Use the reference to check the status later.",
  },
];

export default function ExchangePage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Exchange"
        title="Swap NGN and GHS with a clear quote."
        description="TrustPay is built mainly for exchange. You see the rate, fee, amount, and receipt before you move on."
      >
        <Button asChild>
          <Link href="/register">
            Start exchange
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/security">See safety checks</Link>
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
            <a
              href={marketingImages.exchangeApp.href}
              className="absolute bottom-4 left-4 rounded-full border border-white/12 bg-black/38 px-3 py-1 text-xs text-white/70 backdrop-blur hover:text-white"
              target="_blank"
              rel="noreferrer"
            >
              {marketingImages.exchangeApp.credit}
            </a>
          </div>

          <div className="flex flex-col gap-8">
            <SectionHeading
              eyebrow="How exchange works"
              title="No hidden steps."
              description="The screen should make the money path easy to scan: source, rate, fee, destination, and status."
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
        <div className="mx-auto flex max-w-7xl flex-col gap-6 rounded-[1.25rem] border border-orange-300/25 bg-[linear-gradient(135deg,rgba(249,115,22,0.2),rgba(34,197,94,0.08),rgba(255,255,255,0.04))] p-8 text-white md:p-12">
          <ShieldCheck aria-hidden="true" className="size-10 text-orange-300" />
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="max-w-3xl">
              <h2 className="text-3xl font-semibold leading-tight text-balance md:text-5xl">
                Exchange should feel calm.
              </h2>
              <p className="mt-4 text-base leading-7 text-white/64">
                Clear rates, clear fees, and clear receipts help users trust
                the result.
              </p>
            </div>
            <Button size="lg" asChild className="bg-orange-500 text-white hover:bg-orange-400">
              <Link href="/register">
                Create wallet
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
