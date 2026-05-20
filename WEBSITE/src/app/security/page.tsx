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
        title="Security for every wallet action."
        description="TrustPay protects sign in, wallet activity, payment retries, receipts, and admin actions with clear controls."
      >
        <Button asChild>
          <Link href="/register">
            Create Account
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/support">Report an Issue</Link>
        </Button>
      </PageHero>

      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <SectionHeading
            eyebrow="Controls"
            title="Security is a product surface, not footer fine print."
            description="Users should know how their account, money movement, and support records are protected."
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
              Every money movement should be traceable, retry-safe, and reversible when needed.
            </h2>
            <p className="text-base leading-7 text-background/72">
              TrustPay should prevent duplicate payments, avoid silent balance changes,
              and show clear outcomes users can understand.
            </p>
          </div>
          <div className="grid gap-3">
            {securityChecklist.map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.06] p-4">
                <CheckCircle2 aria-hidden="true" className="size-5 text-orange-300" />
                <span className="text-sm font-medium">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
