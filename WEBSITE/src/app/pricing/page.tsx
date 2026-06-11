import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { PageHero } from "@/components/marketing/page-hero";
import { SectionHeading } from "@/components/marketing/section-heading";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { pricingPlans } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Pricing | TrustPay",
  description:
    "TrustPay pricing for personal wallets, everyday exchange and bill payment users, and business onboarding.",
};

const feeRows = [
  { service: "Wallet Setup", note: "Create NGN and GHS balances", position: "Free" },
  { service: "Currency Exchange", note: "Quoted before confirmation", position: "Low transparent fee" },
  { service: "Airtime & Data", note: "Provider amount shown before purchase", position: "Service fee shown in flow" },
  { service: "Withdrawals", note: "Verified destinations and status tracking", position: "Network fee shown in flow" },
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Pricing"
        title="Simple fees before you confirm."
        description="TrustPay shows the fee, rate, and final amount before you make an exchange, bill payment, or withdrawal."
      >
        <Button asChild>
          <a href="https://wa.me/233555507240?text=Hello%20TrustPay%2C%20I%20want%20to%20get%20started." target="_blank" rel="noreferrer">
            Get Started on WhatsApp
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </a>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/support">Ask a Pricing Question</Link>
        </Button>
      </PageHero>

      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-10">
          <SectionHeading
            eyebrow="Plans"
            title="Start personal, grow into operational usage."
            description="Use TrustPay for daily wallet activity, then grow into higher-volume business needs when you are ready."
          />
          <div className="grid gap-4 md:grid-cols-3">
            {pricingPlans.map((plan) => (
              <Card key={plan.title} className="rounded-lg">
                <CardHeader>
                  <CardTitle>{plan.title}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <p className="text-3xl font-semibold">{plan.price}</p>
                  <div className="flex flex-col gap-3">
                    {plan.points.map((point) => (
                      <span key={point} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 aria-hidden="true" className="size-4 text-primary" />
                        {point}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-muted/35 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <SectionHeading
            eyebrow="Fee Clarity"
            title="Know the cost before you pay."
            description="Each flow should show the amount, fee, and expected result before you confirm."
          />
          <Card className="rounded-lg">
            <CardContent className="pt-2">
              <Table>
                <TableCaption>Exact provider fees should be shown inside the confirmed transaction flow.</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Context</TableHead>
                    <TableHead>Positioning</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {feeRows.map((row) => (
                    <TableRow key={row.service}>
                      <TableCell className="font-medium">{row.service}</TableCell>
                      <TableCell>{row.note}</TableCell>
                      <TableCell>{row.position}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </section>
    </MarketingShell>
  );
}
