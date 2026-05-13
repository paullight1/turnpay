import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LifeBuoy } from "lucide-react";

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
import { faqItems, supportChannels } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Support | TrustPay",
  description:
    "Get TrustPay help for accounts, wallets, transaction references, product questions, and business onboarding.",
};

export default function SupportPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Support"
        title="Help paths built around the way users describe payment problems."
        description="Support content focuses on accounts, verification, transaction references, receipts, and business onboarding."
      >
        <Button asChild>
          <Link href="/login">
            Sign In for Support
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/features">Review Features</Link>
        </Button>
      </PageHero>

      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-10">
          <SectionHeading
            eyebrow="Support Channels"
            title="Route the question before it becomes a ticket."
            description="The new support page gives users obvious categories and the information they need before contacting the team."
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {supportChannels.map((channel) => {
              const Icon = channel.icon;

              return (
                <Card key={channel.title} className="rounded-lg">
                  <CardHeader>
                    <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon aria-hidden="true" className="size-5" />
                    </div>
                    <CardTitle>{channel.title}</CardTitle>
                    <CardDescription>{channel.description}</CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-muted/35 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="flex flex-col gap-4">
            <Badge variant="secondary" className="w-fit">
              FAQ
            </Badge>
            <h2 className="text-3xl font-semibold leading-tight text-balance md:text-5xl">
              Answers that reduce uncertainty before signup.
            </h2>
            <p className="text-base leading-7 text-muted-foreground">
              These public answers stay specific to the current TrustPay product surface.
            </p>
          </div>
          <div className="grid gap-4">
            {faqItems.map((item) => (
              <div key={item.question} className="rounded-lg border border-border bg-background p-5">
                <h3 className="text-base font-semibold">{item.question}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 rounded-lg border border-border bg-primary p-8 text-primary-foreground md:p-12">
          <LifeBuoy aria-hidden="true" className="size-10" />
          <h2 className="max-w-3xl text-3xl font-semibold leading-tight text-balance md:text-5xl">
            Keep the reference close when asking about a transaction.
          </h2>
          <p className="max-w-3xl text-base leading-7 text-primary-foreground/78">
            Transaction references, currency, amount, and time make payment support faster and safer.
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
