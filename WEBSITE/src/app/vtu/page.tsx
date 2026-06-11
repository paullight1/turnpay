import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Bolt,
  Cable,
  Smartphone,
  Wifi,
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
  title: "VTU Services | TrustPay",
  description:
    "Buy airtime, data, TV, and electricity services from your TrustPay wallet.",
};

const vtuServices = [
  {
    icon: Smartphone,
    title: "Airtime",
    description: "Top up a phone number from your wallet.",
  },
  {
    icon: Wifi,
    title: "Data",
    description: "Buy data bundles and see the amount first.",
  },
  {
    icon: Cable,
    title: "TV",
    description: "Pay TV bills with a clear reference.",
  },
  {
    icon: Bolt,
    title: "Electricity",
    description: "Recharge power and track the order status.",
  },
];

export default function VtuPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="VTU"
        title="Pay airtime, data, TV, and power from one wallet."
        description="TrustPay VTU is for everyday utility payments. Pick the service, check the amount, pay, and keep the receipt."
      >
        <Button asChild>
          <a href="https://wa.me/233555507240?text=Hello%20TrustPay%2C%20I%20want%20to%20get%20started." target="_blank" rel="noreferrer">
            Get Started on WhatsApp
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </a>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/exchange">See exchange</Link>
        </Button>
      </PageHero>

      <section className="bg-[#0a0d0b] px-4 py-20 text-white sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="flex flex-col gap-8">
            <SectionHeading
              eyebrow="VTU services"
              title="The bills users pay often."
              description="The flow should stay simple: choose a service, enter the phone or bill detail, review the amount, then track the result."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {vtuServices.map((service) => {
                const Icon = service.icon;

                return (
                  <Card key={service.title} className="rounded-lg">
                    <CardHeader>
                      <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                        <Icon aria-hidden="true" className="size-5" />
                      </div>
                      <CardTitle>{service.title}</CardTitle>
                      <CardDescription>{service.description}</CardDescription>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          </div>

          <div className="relative min-h-[520px] overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.05] trustpay-focus-card">
            <Image
              src={marketingImages.dataApp.src}
              alt={marketingImages.dataApp.alt}
              fill
              sizes="(min-width: 1024px) 40vw, 100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(5,6,5,0.82))]" />
            <a
              href={marketingImages.dataApp.href}
              className="absolute bottom-4 left-4 rounded-full border border-white/12 bg-black/38 px-3 py-1 text-xs text-white/70 backdrop-blur hover:text-white"
              target="_blank"
              rel="noreferrer"
            >
              {marketingImages.dataApp.credit}
            </a>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-2">
          {[
            ["Review first", "Check provider, number, amount, and fee before payment."],
            ["Track status", "See pending, successful, failed, and reversed VTU orders."],
          ].map(([title, text]) => (
            <div
              key={title}
              className="rounded-lg border border-white/10 bg-white/[0.06] p-6 text-white trustpay-focus-card"
            >
              <BadgeCheck aria-hidden="true" className="size-5 text-red-400" />
              <h2 className="mt-4 text-xl font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/66">{text}</p>
            </div>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
