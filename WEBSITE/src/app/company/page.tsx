import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

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
import { companyValues } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Company | TrustPay",
  description:
    "Learn about TrustPay's focus on practical Ghana and Nigeria wallet, exchange, and payment workflows.",
};

const milestones = [
  {
    title: "Wallet Foundation",
    text: "NGN and GHS balances, account flows, profile surfaces, and dashboard visibility.",
  },
  {
    title: "Payment Utility",
    text: "Airtime, data, cable, electricity, funding, exchange, and withdrawals shaped as repeatable journeys.",
  },
  {
    title: "Operational Trust",
    text: "Auditability, validation, idempotency, and support-ready references across critical actions.",
  },
];

export default function CompanyPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Company"
        title="A focused financial product for everyday cross-border utility."
        description="TrustPay is positioned around practical user needs across Ghana and Nigeria: exchange, wallet balances, VTU payments, withdrawals, and clear records."
      >
        <Button asChild>
          <Link href="/features">
            Explore Product
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/support">Contact Support</Link>
        </Button>
      </PageHero>

      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-10">
          <SectionHeading
            eyebrow="What Matters"
            title="A sharper company story than generic fintech ambition."
            description="TrustPay focuses on useful wallet tools, clear payment status, and practical money movement across Ghana and Nigeria."
          />
          <div className="grid gap-4 md:grid-cols-3">
            {companyValues.map((value) => {
              const Icon = value.icon;

              return (
                <Card key={value.title} className="rounded-lg">
                  <CardHeader>
                    <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon aria-hidden="true" className="size-5" />
                    </div>
                    <CardTitle>{value.title}</CardTitle>
                    <CardDescription>{value.description}</CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-muted/35 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <SectionHeading
            eyebrow="Roadmap Narrative"
            title="Where the product is headed."
            description="TrustPay is growing around wallet utility, bill payments, safe withdrawals, and better support records."
          />
          <div className="grid gap-4">
            {milestones.map((milestone, index) => (
              <div key={milestone.title} className="rounded-lg border border-border bg-background p-5">
                <p className="text-sm font-semibold text-primary tabular-nums">0{index + 1}</p>
                <h2 className="mt-3 text-lg font-semibold">{milestone.title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{milestone.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
