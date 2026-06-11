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
import { securityControls } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Security | TrustPay",
  description:
    "TrustPay security principles for authentication, idempotent transactions, protected routes, and audit-ready financial records.",
};

const securityChecklist = [
  "Protected user and admin surfaces",
  "Idempotency for payment-style mutation flows",
  "Input validation before sensitive operations",
  "Audit logs for financial and administrative actions",
  "Short-lived access tokens with refresh discipline",
  "Clear receipt and status records for user support",
];

export default function SecurityPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Security"
        title="Checks for every wallet action."
        description="TrustPay protects sign in, wallet activity, payment retries, receipts, and admin work."
      >
        <Button asChild>
          <a href="https://wa.me/233555507240?text=Hello%20TrustPay%2C%20I%20want%20to%20get%20started." target="_blank" rel="noreferrer">
            Get Started on WhatsApp
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </a>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/support">Report an Issue</Link>
        </Button>
      </PageHero>

      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <SectionHeading
            eyebrow="Controls"
            title="Security should be easy to see."
            description="Users should know how their account, money, and support records are protected."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {securityControls.map((control) => {
              const Icon = control.icon;

              return (
                <Card key={control.title} className="rounded-lg">
                  <CardHeader>
                    <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon aria-hidden="true" className="size-5" />
                    </div>
                    <CardTitle>{control.title}</CardTitle>
                    <CardDescription>{control.description}</CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-[#0d100e] px-4 py-20 text-white sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div className="flex flex-col gap-4">
            <Badge variant="secondary" className="w-fit">
              Financial Integrity
            </Badge>
            <h2 className="text-3xl font-semibold leading-tight text-balance md:text-5xl">
              Every money move should be traceable and retry-safe.
            </h2>
            <p className="text-base leading-7 text-white/72">
              TrustPay should stop duplicate payments, avoid silent balance changes,
              and show clear outcomes.
            </p>
          </div>
          <div className="grid gap-3">
            {securityChecklist.map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.06] p-4">
                <CheckCircle2 aria-hidden="true" className="size-5 text-red-400" />
                <span className="text-sm font-medium">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
