import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { PageHero } from "@/components/marketing/page-hero";
import { SectionHeading } from "@/components/marketing/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { corridorSteps, productFeatures, serviceRows } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Features | TrustPay",
  description:
    "Explore TrustPay exchange, VTU payments, receipts, and risk-aware wallet workflows.",
};

export default function FeaturesPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Features"
        title="One wallet for common money jobs."
        description="Exchange NGN and GHS, pay VTU bills, and track each receipt."
      >
        <Button asChild>
          <Link href="/register">
            Create wallet
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/security">See Trust Controls</Link>
        </Button>
      </PageHero>

      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-10">
          <SectionHeading
            eyebrow="Core Capabilities"
            title="The tools you use most."
            description="Swap currency, pay airtime, buy data, pay TV or power, verify ID, and see proof."
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {productFeatures.map((feature) => {
              const Icon = feature.icon;

              return (
                <Card key={feature.title} className="rounded-lg">
                  <CardHeader>
                    <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon aria-hidden="true" className="size-5" />
                    </div>
                    <CardTitle>{feature.title}</CardTitle>
                    <CardDescription>{feature.description}</CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-muted/35 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionHeading
            eyebrow="Service Map"
            title="Two service paths from one wallet."
            description="Exchange is the main path. VTU covers everyday utility payments."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {serviceRows.map((service) => {
              const Icon = service.icon;

              return (
                <div key={service.title} className="rounded-lg border border-border bg-background p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                      <Icon aria-hidden="true" className="size-5" />
                    </div>
                    <Badge variant="outline">{service.metric}</Badge>
                  </div>
                  <h2 className="mt-4 text-lg font-semibold">{service.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {service.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-10">
          <SectionHeading
            eyebrow="User Flow"
            title="From sign up to receipt."
            description="A money move should show source, rate, fee, destination, and status."
            align="center"
          />
          <div className="grid gap-4 md:grid-cols-4">
            {corridorSteps.map((step, index) => {
              const Icon = step.icon;

              return (
                <div key={step.title} className="rounded-lg border border-border bg-card p-5">
                  <span className="text-sm font-semibold text-primary tabular-nums">
                    Step {index + 1}
                  </span>
                  <div className="mt-5 grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon aria-hidden="true" className="size-5" />
                  </div>
                  <h2 className="mt-4 text-base font-semibold">{step.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
                </div>
              );
            })}
          </div>
          <div className="rounded-lg border border-border bg-muted/35 p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <CheckCircle2 aria-hidden="true" className="mt-1 size-5 text-primary" />
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  TrustPay keeps each money move clear: amount, currency, fee, destination, and status.
                </p>
              </div>
              <Button variant="outline" asChild className="w-fit">
                <Link href="/dashboard">View Dashboard</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
