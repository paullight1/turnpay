import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionHeading } from "@/components/marketing/section-heading";
import {
  corridorSteps,
  heroStats,
  liveRails,
  pricingPlans,
  productFeatures,
  securityControls,
  serviceRows,
  testimonials,
} from "@/lib/marketing";

function HeroSection() {
  return (
    <section className="relative isolate flex min-h-[86svh] items-center overflow-hidden px-4 pb-14 pt-28 sm:px-6 lg:px-8">
      <Image
        src="/trustpay-hero.svg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="absolute inset-0 -z-20 h-full w-full object-cover"
      />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,var(--background)_0%,color-mix(in_oklab,var(--background)_90%,transparent)_38%,color-mix(in_oklab,var(--background)_56%,transparent)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-36 bg-[linear-gradient(0deg,var(--background)_0%,transparent_100%)]" />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-9">
        <div className="flex max-w-3xl flex-col gap-6">
          <Badge variant="secondary" className="w-fit">
            Ghana-Nigeria Wallet Corridor
          </Badge>
          <div className="flex flex-col gap-4">
            <h1 className="text-5xl font-semibold leading-[1.02] text-balance md:text-7xl">
              TrustPay
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
              A clean financial home for NGN and GHS wallets, transparent exchange, airtime,
              data, cable, electricity, and withdrawals.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link href="/register">
                Create Account
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/features">Explore Features</Link>
            </Button>
          </div>
        </div>

        <div className="grid max-w-4xl gap-3 sm:grid-cols-3">
          {heroStats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-border/75 bg-background/78 p-4 shadow-sm backdrop-blur-md"
            >
              <p className="text-2xl font-semibold tabular-nums">{stat.value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="max-w-5xl overflow-hidden rounded-lg border border-border/75 bg-background/78 py-3 shadow-sm backdrop-blur-md">
          <div className="animate-trustpay-marquee flex w-max gap-3 px-3 motion-reduce:animate-none">
            {[...liveRails, ...liveRails].map((item, index) => (
              <span
                key={`${item}-${index}`}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-3 py-1 text-sm text-muted-foreground"
              >
                <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureSection() {
  return (
    <section className="px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-10">
        <SectionHeading
          eyebrow="Product"
          title="Everything users expect from a serious wallet, without the clutter."
          description="TrustPay turns exchange, VTU, funding, withdrawals, and transaction visibility into one repeated workflow."
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
  );
}

function CorridorSection() {
  return (
    <section className="bg-muted/35 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center">
        <div className="flex flex-col gap-8">
          <SectionHeading
            eyebrow="Live Operations"
            title="Designed for the messy middle between banks, wallets, and billers."
            description="The public site now mirrors what the product does: quote clearly, capture intent, prevent accidental repeats, and keep the user informed."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {serviceRows.map((service) => {
              const Icon = service.icon;

              return (
                <div
                  key={service.title}
                  className="rounded-lg border border-border bg-background p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                      <Icon aria-hidden="true" className="size-5" />
                    </div>
                    <Badge variant="outline">{service.metric}</Badge>
                  </div>
                  <h3 className="mt-4 text-base font-semibold">{service.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {service.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Image
            src="/trustpay-operations.svg"
            alt="TrustPay dashboard preview with wallet balances, exchange quotes, and bill payment activity"
            width={1200}
            height={900}
            loading="lazy"
            className="h-auto w-full rounded-lg border border-border bg-background shadow-xl"
          />
          <Tabs defaultValue="exchange" className="rounded-lg border border-border bg-background p-3 shadow-sm">
            <TabsList className="w-full">
              <TabsTrigger value="exchange">Exchange</TabsTrigger>
              <TabsTrigger value="bills">Bills</TabsTrigger>
              <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
            </TabsList>
            <TabsContent value="exchange" className="pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-sm text-muted-foreground">You Send</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">GHS 2,450</p>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-sm text-muted-foreground">Recipient Gets</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">NGN 515,000</p>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="bills" className="pt-4">
              <div className="flex items-center gap-3 rounded-lg bg-muted p-4">
                <ReceiptText aria-hidden="true" className="size-5 text-primary" />
                <p className="text-sm text-muted-foreground">
                  Cable, electricity, airtime, and data purchases stay attached to wallet receipts.
                </p>
              </div>
            </TabsContent>
            <TabsContent value="withdraw" className="pt-4">
              <div className="flex items-center gap-3 rounded-lg bg-muted p-4">
                <LockKeyhole aria-hidden="true" className="size-5 text-primary" />
                <p className="text-sm text-muted-foreground">
                  Withdrawals are positioned around verified destinations and clear status tracking.
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </section>
  );
}

function SecuritySection() {
  return (
    <section className="bg-foreground px-4 py-20 text-background sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div className="flex flex-col gap-5">
          <Badge variant="secondary" className="w-fit">
            Trust Layer
          </Badge>
          <h2 className="text-3xl font-semibold leading-tight text-balance md:text-5xl">
            Security messaging that matches a financial product.
          </h2>
          <p className="text-base leading-7 text-background/72 md:text-lg">
            The site now foregrounds the principles users care about: protected sessions,
            idempotent transaction flows, audit-ready history, and clear receipts.
          </p>
          <Button variant="secondary" asChild className="w-fit">
            <Link href="/security">
              Review Security
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {securityControls.map((control) => {
            const Icon = control.icon;

            return (
              <div
                key={control.title}
                className="rounded-lg border border-background/12 bg-background/8 p-5"
              >
                <div className="grid size-10 place-items-center rounded-lg bg-background text-foreground">
                  <Icon aria-hidden="true" className="size-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold">{control.title}</h3>
                <p className="mt-2 text-sm leading-6 text-background/70">{control.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function StepsSection() {
  return (
    <section className="px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-10">
        <SectionHeading
          eyebrow="Workflow"
          title="A repeatable path for every money movement."
          description="Each step keeps the user oriented so they can move from wallet setup to receipt without hunting for context."
          align="center"
        />
        <div className="grid gap-4 md:grid-cols-4">
          {corridorSteps.map((step, index) => {
            const Icon = step.icon;

            return (
              <div key={step.title} className="relative rounded-lg border border-border bg-card p-5">
                <span className="text-sm font-semibold text-primary tabular-nums">
                  0{index + 1}
                </span>
                <div className="mt-5 grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon aria-hidden="true" className="size-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PricingPreview() {
  return (
    <section className="bg-muted/35 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-10">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <SectionHeading
            eyebrow="Pricing"
            title="Simple public positioning for personal and business users."
            description="Plans describe how TrustPay can grow from personal wallet use into operational teams."
          />
          <Button variant="outline" asChild className="w-fit">
            <Link href="/pricing">
              See Pricing
              <ChevronRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </div>
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
  );
}

function TestimonialsSection() {
  return (
    <section className="px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-10">
        <SectionHeading
          eyebrow="Feedback"
          title="A public story that feels closer to the product users will open."
          description="The redesign trades generic fintech copy for concrete TrustPay surfaces: exchange, receipts, bills, and wallet history."
          align="center"
        />
        <div className="grid gap-4 md:grid-cols-3">
          {testimonials.map((item) => (
            <Card key={item.name} className="rounded-lg">
              <CardHeader>
                <BadgeCheck aria-hidden="true" className="size-5 text-primary" />
                <CardTitle className="text-lg">{item.quote}</CardTitle>
                <CardDescription>
                  {item.name}, {item.role}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  return (
    <section className="px-4 pb-20 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 rounded-lg border border-border bg-primary p-8 text-primary-foreground shadow-lg md:p-12">
        <ShieldCheck aria-hidden="true" className="size-10" />
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="flex max-w-3xl flex-col gap-3">
            <h2 className="text-3xl font-semibold leading-tight text-balance md:text-5xl">
              Start with a wallet that respects the transaction.
            </h2>
            <p className="text-base leading-7 text-primary-foreground/78">
              Create an account, provision balances, and keep exchange, VTU, withdrawals,
              and receipts in one place.
            </p>
          </div>
          <Button variant="secondary" size="lg" asChild>
            <Link href="/register">
              Open Wallet
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

export function LandingPage() {
  return (
    <>
      <HeroSection />
      <FeatureSection />
      <CorridorSection />
      <SecuritySection />
      <StepsSection />
      <PricingPreview />
      <TestimonialsSection />
      <CtaSection />
    </>
  );
}
