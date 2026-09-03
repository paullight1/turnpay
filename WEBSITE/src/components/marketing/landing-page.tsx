"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  blogArticles,
  productFeatures,
  securityControls,
  testimonials,
  faqItems as faqData,
  companyValues,
} from "@/lib/marketing";

// ─── DATA ──────────────────────────────────────────────────────────────────────

const stats = [
  { value: "250+", label: "Happy Clients" },
  { value: "90%", label: "Customer Satisfaction" },
  { value: "5k+", label: "Successful Payments" },
  { value: "100%", label: "Security Controls" },
];

const trustedBanks = [
  { name: "MTN MoMo", src: "/bank-logos/mtn-momo.svg", market: "Mobile money" },
  { name: "FirstBank", src: "/bank-logos-real/firstbank.svg", market: "Nigeria" },
  { name: "Zenith Bank", src: "/bank-logos-real/zenith.svg", market: "Nigeria" },
  { name: "Moniepoint", src: "/bank-logos-real/moniepoint.svg", market: "Nigeria" },
  { name: "GTBank", src: "/bank-logos/gtbank.svg", market: "Nigeria" },
  { name: "UBA", src: "/bank-logos/uba.svg", market: "Pan-African" },
  { name: "Ecobank", src: "/bank-logos-real/ecobank.svg", market: "Pan-African" },
  { name: "GCB Bank", src: "/bank-logos/gcb.svg", market: "Ghana" },
  { name: "Fidelity Bank", src: "/bank-logos/fidelity-gh.svg", market: "Ghana" },
  { name: "Absa Ghana", src: "/bank-logos-real/absa.svg", market: "Ghana" },
  { name: "Stanbic Ghana", src: "/bank-logos/stanbic-gh.svg", market: "Ghana" },
  { name: "Access Bank", src: "/bank-logos-real/access.png", market: "Africa" },
];

const heroSlides = [
  {
    title: "Exchange Naira and Cedis in Minutes.",
    image:
      "https://images.unsplash.com/photo-1579621970795-87facc2f976d?auto=format&fit=crop&q=85&w=2200",
    context: "Live NGN to GHS exchange",
  },
  {
    title: "Send Money Across Ghana and Nigeria, Fast.",
    image:
      "https://images.unsplash.com/photo-1556742031-c6961e8560b0?auto=format&fit=crop&q=85&w=2200",
    context: "Cross-border transfers",
  },
  {
    title: "The Easy Way to Exchange Naira and Cedis.",
    image:
      "https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&q=85&w=2200",
    context: "Simple, secure payments",
  },
];

const useCases = [
  {
    title: "Freelancers",
    description: "Get paid in NGN or GHS, then withdraw locally.",
    image:
      "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&q=80&w=1200",
    alt: "Freelancers working together on laptops",
    tag: "Client payments",
  },
  {
    title: "Businesses",
    description: "Pay suppliers and teams across Ghana and Nigeria.",
    image:
      "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&q=80&w=1200",
    alt: "Business team reviewing payment work",
    tag: "Team payouts",
  },
  {
    title: "Travelers",
    description: "Exchange, top up, and pay bills while on the move.",
    image:
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&q=80&w=1200",
    alt: "Traveler walking near the coast",
    tag: "On-the-go money",
  },
];

const processSteps = [
  {
    title: "Create wallet",
    description: "Open NGN and GHS balances.",
    image:
      "https://images.unsplash.com/photo-1556742044-3c52d6e88c62?auto=format&fit=crop&q=80&w=1200",
    alt: "Person setting up a mobile wallet on a phone",
  },
  {
    title: "Pick service",
    description: "Exchange, send, or pay bills.",
    image:
      "https://images.unsplash.com/photo-1556742502-ec7c0e9f34b1?auto=format&fit=crop&q=80&w=1200",
    alt: "Mobile payment being reviewed",
  },
  {
    title: "Review details",
    description: "See fees before you confirm.",
    image:
      "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&q=80&w=1200",
    alt: "Payment details and financial paperwork",
  },
  {
    title: "Track status",
    description: "Follow every transfer clearly.",
    image:
      "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&q=80&w=1200",
    alt: "Dashboard showing financial activity",
  },
];

const featureCardStyles = [
  {
    card: "border-rose-100 bg-rose-50/80 hover:shadow-rose-100/50",
    icon: "bg-white text-rose-600",
  },
  {
    card: "border-emerald-100 bg-emerald-50/80 hover:shadow-emerald-100/50",
    icon: "bg-white text-emerald-600",
  },
  {
    card: "border-sky-100 bg-sky-50/80 hover:shadow-sky-100/50",
    icon: "bg-white text-sky-600",
  },
  {
    card: "border-violet-100 bg-violet-50/80 hover:shadow-violet-100/50",
    icon: "bg-white text-violet-600",
  },
  {
    card: "border-amber-100 bg-amber-50/80 hover:shadow-amber-100/50",
    icon: "bg-white text-amber-600",
  },
  {
    card: "border-slate-200 bg-slate-100/80 hover:shadow-slate-200/60",
    icon: "bg-white text-slate-700",
  },
];

const testimonialProfiles = [
  {
    image:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=400",
    alt: "Portrait of Nana K.",
  },
  {
    image:
      "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&q=80&w=400",
    alt: "Portrait of Chidinma A.",
  },
  {
    image:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=400",
    alt: "Portrait of Kojo M.",
  },
];

const whyTrustPayImages = [
  {
    src: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&q=80&w=1200",
    alt: "People connecting across a busy city street",
    tag: "Ghana + Nigeria",
  },
  {
    src: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&q=80&w=1200",
    alt: "Financial details being reviewed on a desk",
    tag: "Clear rates",
  },
  {
    src: "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&q=80&w=1200",
    alt: "Records and payment documents on a desk",
    tag: "Clean records",
  },
];

// ─── COMPONENTS ────────────────────────────────────────────────────────────────

function SectionHeading({
  eyebrow,
  title,
  description,
  centered = true,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  centered?: boolean;
}) {
  return (
    <div className={`max-w-2xl ${centered ? "mx-auto text-center" : ""}`}>
      {eyebrow && (
        <p className="mb-3 inline-block rounded-full bg-red-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-red-700">
          {eyebrow}
        </p>
      )}
      <h2 className="text-3xl font-bold leading-tight tracking-tight text-gray-900 md:text-4xl lg:text-5xl">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-base leading-7 text-gray-500 md:text-lg">
          {description}
        </p>
      )}
    </div>
  );
}

// ─── HERO ──────────────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className="relative isolate min-h-[84svh] overflow-hidden bg-slate-950 lg:min-h-[88svh]">
      <div className="absolute inset-0 -z-10">
        {heroSlides.map((slide, index) => (
          <div
            key={slide.title}
            className="trustpay-hero-bg absolute inset-0"
            style={{ animationDelay: `${index * 5 - 0.6}s` }}
          >
            <Image
              src={slide.image}
              alt=""
              fill
              className="scale-105 object-cover"
              priority={index === 0}
              sizes="100vw"
            />
          </div>
        ))}
        <div className="absolute inset-0 bg-gradient-to-r from-black/92 via-black/68 to-black/32" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/64 via-transparent to-black/24" />
      </div>

      <div className="mx-auto flex min-h-[84svh] max-w-7xl items-center px-4 pb-12 pt-24 sm:px-6 sm:pb-16 sm:pt-28 lg:min-h-[88svh] lg:px-8 xl:py-28">
        <div className="grid w-full items-center xl:grid-cols-[minmax(0,1fr)_22rem] xl:gap-16">
          <div className="max-w-4xl">
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[0.72rem] font-medium text-white/90 backdrop-blur-md sm:px-4 sm:text-sm">
              <span className="shrink-0 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white">
                Live
              </span>
              <span>Nigeria and Ghana money corridor</span>
            </div>

            <h1 className="sr-only">
              Exchange Naira and Cedis in Minutes. Send Money Across Ghana and
              Nigeria, Fast. The Easy Way to Exchange Naira and Cedis.
            </h1>

            <div
              aria-hidden="true"
              className="relative mt-7 min-h-[13.5rem] overflow-hidden sm:min-h-[15rem] md:min-h-[16rem] lg:min-h-[15.5rem] xl:min-h-[16.5rem]"
            >
              {heroSlides.map((slide, index) => (
                <p
                  key={slide.title}
                  className="trustpay-hero-copy absolute inset-x-0 top-0 max-w-4xl text-[clamp(2.65rem,12vw,3.5rem)] font-bold leading-[0.98] tracking-[-0.045em] text-white sm:text-[4.25rem] md:text-[4.75rem] lg:text-[5rem] xl:text-[5.5rem]"
                  style={{ animationDelay: `${index * 5 - 0.6}s` }}
                >
                  {slide.title}
                </p>
              ))}
            </div>

            <p className="mt-4 max-w-2xl text-base leading-7 text-white/76 sm:mt-5 sm:text-lg sm:leading-8">
              Get competitive exchange rates, fast transactions, and secure
              transfers between Nigeria and Ghana.
            </p>

            <div className="mt-7 flex flex-col items-stretch gap-3 sm:mt-8 sm:flex-row sm:items-center sm:gap-4">
              <Button
                asChild
                className="h-13 w-full rounded-full bg-red-600 px-7 text-base font-semibold text-white shadow-lg shadow-red-600/30 transition-all hover:bg-red-700 hover:shadow-xl hover:shadow-red-600/40 sm:w-auto"
              >
                <a href="https://wa.me/233555507240?text=Hello%20TrustPay%2C%20I%20want%20to%20get%20started." target="_blank" rel="noreferrer">
                  Get Started Free
                  <ArrowRight data-icon="inline-end" aria-hidden="true" className="size-5" />
                </a>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-13 w-full rounded-full border-white/30 bg-white/10 px-7 text-base font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/20 hover:text-white sm:w-auto"
              >
                <Link href="/exchange">
                  View Rates
                </Link>
              </Button>
            </div>

          </div>

          <div className="hidden border-l border-white/15 pl-7 text-white xl:block">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-white/50">
                  Corridor status
                </p>
                <p className="mt-1 text-lg font-semibold">TrustPay corridor</p>
              </div>
              <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200">
                Active
              </span>
            </div>
            <div className="mt-5 space-y-3">
              {heroSlides.map((slide, index) => (
                <div
                  key={slide.context}
                  className="trustpay-hero-context border-b border-white/10 pb-4"
                  style={{ animationDelay: `${index * 5 - 0.6}s` }}
                >
                  <p className="text-sm font-semibold">{slide.context}</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <span className="trustpay-hero-progress block h-full rounded-full bg-red-400" />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-6 text-sm">
              <div>
                <span className="block text-white/55">From</span>
                <strong className="mt-1 block text-xl">NGN</strong>
              </div>
              <div>
                <span className="block text-white/55">To</span>
                <strong className="mt-1 block text-xl">GHS</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── FEATURES GRID ─────────────────────────────────────────────────────────────

function FeaturesSection() {
  return (
    <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Features"
          title="Everything You Need in One Wallet"
          description="From multi-currency exchange to utility payments — TrustPay handles your everyday money movement."
        />

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {productFeatures.map((feature, index) => {
            const Icon = feature.icon;
            const style = featureCardStyles[index % featureCardStyles.length];
            return (
              <div
                key={feature.title}
                className={`group rounded-2xl border p-6 transition-all hover:-translate-y-1 hover:shadow-xl ${style.card}`}
              >
                <span className={`mb-4 flex size-12 items-center justify-center rounded-xl shadow-sm ring-1 ring-black/5 ${style.icon}`}>
                  <Icon aria-hidden="true" className="size-6" />
                </span>
                <h3 className="text-lg font-semibold text-gray-900">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── HOW IT WORKS ──────────────────────────────────────────────────────────────

function HowItWorksSection() {
  return (
    <section className="bg-gray-50 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Process"
          title="How It Works"
          description="Four simple steps. Clear from start to finish."
        />

        <div className="mt-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {processSteps.map((step, index) => (
            <article
              key={step.title}
              className="group overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-red-100/30"
            >
              <div className="relative aspect-[16/11] overflow-hidden bg-gray-100">
                <Image
                  src={step.image}
                  alt={step.alt}
                  fill
                  unoptimized
                  sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover transition duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />
                <span className="absolute left-4 top-4 rounded-full bg-white px-3 py-1 text-xs font-black text-red-700 shadow-sm">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <div className="p-5">
                <h3 className="text-lg font-bold text-gray-900">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-gray-500">
                  {step.description}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── USE CASES ─────────────────────────────────────────────────────────────────

function UseCasesSection() {
  return (
    <section className="bg-gray-50 px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Who It's For"
          title="Built for Real People"
          description="Simple money tools for everyday cross-border needs."
        />

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {useCases.map((useCase) => (
            <article
              key={useCase.title}
              className="group overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-red-100/30"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-gray-100">
                <Image
                  src={useCase.image}
                  alt={useCase.alt}
                  fill
                  unoptimized
                  sizes="(min-width: 768px) 33vw, 100vw"
                  className="object-cover transition duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/65 to-transparent" />
                <span className="absolute bottom-4 left-4 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-red-700 shadow-sm">
                  {useCase.tag}
                </span>
              </div>
              <div className="p-6">
                <h3 className="text-xl font-bold text-gray-900">
                  {useCase.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-gray-500">
                  {useCase.description}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── STATS ─────────────────────────────────────────────────────────────────────

function StatsSection() {
  return (
    <section className="bg-red-600 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 text-center md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="relative">
              <p className="text-5xl font-black text-white md:text-6xl">{stat.value}</p>
              <p className="mt-2 text-sm font-medium text-red-100">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── TRUSTED BANKS ─────────────────────────────────────────────────────────────

function TrustedBanksSection() {
  const firstRow = trustedBanks.slice(0, 6);
  const secondRow = trustedBanks.slice(6);

  return (
    <section className="bg-white px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Partners"
          title="Trusted by Leading Banks"
          description="We connect with the most trusted financial institutions across Nigeria and Ghana."
        />

        <div className="relative mt-12 overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 py-6">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-gray-50 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-gray-50 to-transparent" />

          {/* First row */}
          <div className="animate-trustpay-marquee flex w-max gap-4 pr-4 [animation-duration:30s]">
            {[...firstRow, ...firstRow].map((bank, index) => (
              <div
                key={`${bank.name}-${index}`}
                className="flex min-w-[220px] items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm"
              >
                <span className="grid h-10 w-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-white p-1.5">
                  <Image
                    src={bank.src}
                    alt={`${bank.name} logo`}
                    width={80}
                    height={40}
                    className="max-h-8 w-full object-contain"
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-gray-900">{bank.name}</span>
                  <span className="block text-xs text-gray-500">{bank.market}</span>
                </span>
              </div>
            ))}
          </div>

          {/* Second row */}
          <div className="animate-trustpay-marquee-reverse mt-4 flex w-max gap-4 pr-4 [animation-duration:34s]">
            {[...secondRow, ...secondRow].map((bank, index) => (
              <div
                key={`${bank.name}-${index}-r`}
                className="flex min-w-[220px] items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm"
              >
                <span className="grid h-10 w-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-white p-1.5">
                  <Image
                    src={bank.src}
                    alt={`${bank.name} logo`}
                    width={80}
                    height={40}
                    className="max-h-8 w-full object-contain"
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-gray-900">{bank.name}</span>
                  <span className="block text-xs text-gray-500">{bank.market}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── WHY TRUSTPAY ──────────────────────────────────────────────────────────────

function WhyTrustPaySection() {
  return (
    <section className="bg-gray-50 px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Why Us"
          title="Why Choose TrustPay?"
          description="Built for Ghana and Nigeria money movement."
        />

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {companyValues.map((value, index) => {
            const Icon = value.icon;
            const image = whyTrustPayImages[index % whyTrustPayImages.length];
            return (
              <div
                key={value.title}
                className="group relative min-h-[340px] overflow-hidden rounded-2xl bg-gray-950 shadow-sm"
              >
                <Image
                  src={image.src}
                  alt={image.alt}
                  fill
                  unoptimized
                  sizes="(min-width: 768px) 33vw, 100vw"
                  className="object-cover transition duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/35 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/14 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
                      <Icon aria-hidden="true" className="size-4 text-red-200" />
                      {image.tag}
                    </span>
                  </div>
                  <h3 className="text-2xl font-bold leading-tight text-white">
                    {value.title}
                  </h3>
                  <p className="mt-2 max-w-xs text-sm leading-6 text-white/72">
                    {value.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── SECURITY ───────────────────────────────────────────────────────────────────

function SecuritySection() {
  return (
    <section className="bg-white px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-12 shadow-2xl shadow-slate-200 sm:px-8 lg:px-12">
          <Image
            src="https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&q=80&w=2000"
            alt=""
            fill
            unoptimized
            sizes="100vw"
            className="object-cover opacity-30 animate-trustpay-soft-pulse"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/82 to-red-950/45" />

          <div className="relative grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div className="max-w-xl">
              <p className="mb-3 inline-block rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-red-100">
                Security
              </p>
              <h2 className="text-3xl font-bold leading-tight tracking-tight text-white md:text-5xl">
                Your Money, Secured
              </h2>
              <p className="mt-4 text-base leading-7 text-white/70 md:text-lg">
                Short sessions. Checked actions. Clear records.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {securityControls.map((control) => {
                const Icon = control.icon;
                return (
                  <div
                    key={control.title}
                    className="rounded-2xl border border-white/12 bg-slate-950/78 p-5 shadow-lg shadow-black/20 backdrop-blur-md"
                  >
                    <span className="flex size-10 items-center justify-center rounded-xl bg-white/10 text-red-200">
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                    <h3 className="mt-4 text-sm font-bold text-white">
                      {control.title}
                    </h3>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── TESTIMONIALS ──────────────────────────────────────────────────────────────

function TestimonialsSection() {
  return (
    <section className="bg-slate-950 px-4 py-24 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 inline-block rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-red-100">
            Testimonials
          </p>
          <h2 className="text-3xl font-bold leading-tight tracking-tight md:text-5xl">
            What Our Users Say
          </h2>
          <p className="mt-4 text-base leading-7 text-white/60 md:text-lg">
            Real people. Everyday money movement.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {testimonials.map((testimonial, index) => {
            const profile = testimonialProfiles[index % testimonialProfiles.length];
            return (
              <div
                key={testimonial.name}
                className="rounded-2xl border border-white/10 bg-white/[0.06] p-7 shadow-xl shadow-black/20"
              >
                <div className="mb-5 flex gap-1 text-amber-300">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <svg key={i} className="size-4 fill-current" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
                <blockquote className="text-sm leading-6 text-white/72">
                  &ldquo;{testimonial.quote}&rdquo;
                </blockquote>
                <div className="mt-6 flex items-center gap-3 border-t border-white/10 pt-6">
                  <span className="relative size-12 overflow-hidden rounded-full ring-2 ring-white/15">
                    <Image
                      src={profile.image}
                      alt={profile.alt}
                      fill
                      unoptimized
                      sizes="48px"
                      className="object-cover"
                    />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {testimonial.name}
                    </p>
                    <p className="text-xs text-white/50">{testimonial.role}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ────────────────────────────────────────────────────────────────────────

function FaqSection() {
  return (
    <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <SectionHeading
          eyebrow="FAQ"
          title="Frequently Asked Questions"
          description="Everything you need to know about TrustPay."
        />

        <div className="mt-12 space-y-3">
          {faqData.map((faq) => (
            <details
              key={faq.question}
              className="group rounded-xl border border-gray-100 bg-white transition-all hover:border-gray-200 [&[open]]:border-red-100 [&[open]]:shadow-sm"
            >
              <summary className="flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 marker:hidden [&::-webkit-details-marker]:hidden">
                <span className="text-sm font-medium text-gray-900 sm:text-base">
                  {faq.question}
                </span>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-red-50 text-sm text-red-600 transition-transform duration-200 group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="border-t border-gray-100 px-6 pb-5 pt-4 text-sm leading-6 text-gray-500">
                {faq.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── BLOG SECTION ───────────────────────────────────────────────────────────────

function BlogSection() {
  const latestArticles = blogArticles.slice(0, 3);

  return (
    <section className="bg-gray-50 px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-2xl">
          <p className="mb-3 inline-block rounded-full bg-red-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-red-700">
            Latest Articles
          </p>
          <h2 className="text-5xl font-bold leading-tight tracking-tight text-gray-900">
            Articles
          </h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-gray-500 md:text-lg">
            NGN and GHS updates, written for everyday users.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {latestArticles.map((article) => (
            <Link
              key={article.slug}
              href={`/blog/${article.slug}`}
              className="group overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all hover:-translate-y-1 hover:border-red-100 hover:shadow-xl hover:shadow-red-100/30"
            >
              <div className="relative aspect-[16/11] bg-gray-100">
                <Image
                  src={article.image.src}
                  alt={article.image.alt}
                  fill
                  unoptimized
                  sizes="(min-width: 768px) 33vw, 100vw"
                  className="object-cover transition duration-500 group-hover:scale-105"
                />
              </div>
              <div className="p-5">
                <h3 className="text-lg font-bold leading-snug text-gray-900 transition-colors group-hover:text-red-600">
                  {article.title}
                </h3>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-gray-700 transition-all hover:border-red-200 hover:text-red-600"
          >
            View all articles
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─── CTA ───────────────────────────────────────────────────────────────────────

function CtaSection() {
  return (
    <section className="relative overflow-hidden px-4 py-24 sm:px-6 lg:px-8">
      <Image
        src="https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&q=80&w=2000"
        alt=""
        fill
        unoptimized
        sizes="100vw"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-red-700/86" />
      <div className="absolute inset-0 bg-gradient-to-r from-red-950/35 via-red-700/70 to-red-500/35" />

      <div className="relative mx-auto max-w-3xl text-center">
        <h2 className="text-4xl font-bold leading-tight text-white md:text-5xl">
          Ready to Simplify Your Money Movement?
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-base leading-7 text-red-50">
          Start moving NGN and GHS with clearer rates, receipts, and support.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Button
            asChild
            className="rounded-full border-2 border-white bg-white px-6 text-red-700 transition-all hover:bg-transparent hover:text-white"
          >
            <a href="https://wa.me/233555507240?text=Hello%20TrustPay%2C%20I%20want%20to%20get%20started." target="_blank" rel="noreferrer">
              Create Free Account
              <ArrowRight data-icon="inline-end" aria-hidden="true" className="size-4" />
            </a>
          </Button>
          <Button
            asChild
            variant="ghost"
            className="text-white/85 hover:bg-white/10 hover:text-white"
          >
            <Link href="/support">Talk to Sales</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

// ─── EXPORT ─────────────────────────────────────────────────────────────────────

export function LandingPage() {
  return (
    <>
      <HeroSection />
      <TrustedBanksSection />
      <FeaturesSection />
      <HowItWorksSection />
      <UseCasesSection />
      <StatsSection />
      <WhyTrustPaySection />
      <BlogSection />
      <SecuritySection />
      <TestimonialsSection />
      <FaqSection />
      <CtaSection />
    </>
  );
}
