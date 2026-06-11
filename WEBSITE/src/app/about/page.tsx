import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Headphones,
  ShieldCheck,
  Star,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "About | TrustPay",
  description:
    "Learn about TrustPay, a wallet, exchange, and VTU payments platform for practical Ghana and Nigeria money movement.",
};

const tickerItems = [
  "NGN-GHS",
  "Wallets",
  "VTU",
  "Receipts",
  "Rates",
  "KYC",
  "Support",
];

const trustCards = [
  {
    icon: ShieldCheck,
    title: "Trusted & Secure",
    text: "Guarded sessions.",
  },
  {
    icon: BadgeCheck,
    title: "Automatically Clear",
    text: "Visible references.",
  },
  {
    icon: BarChart3,
    title: "Trade Algorithm",
    text: "Readable quotes.",
  },
  {
    icon: Headphones,
    title: "24/7 Support",
    text: "Help with context.",
  },
];

const featureImages = [
  {
    src: "https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&q=80&w=1000",
    alt: "Secure mobile payment on a phone",
  },
  {
    src: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&q=80&w=1000",
    alt: "Clear financial paperwork and records",
  },
  {
    src: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=1000",
    alt: "Payment performance analytics",
  },
  {
    src: "https://images.unsplash.com/photo-1556761175-4b46a572b786?auto=format&fit=crop&q=80&w=1000",
    alt: "Support team working together",
  },
];

const timeline = [
  ["01", "Wallet Rails", "NGN and GHS wallets became the base for account activity."],
  ["02", "Secure Controls", "KYC, auth, and payment checks became core product surfaces."],
  ["03", "VTU Expansion", "Airtime, data, TV, and electricity joined the wallet workflow."],
];

function TickerStrip() {
  return (
    <div className="overflow-hidden border-y border-black bg-red-500 py-3 text-black">
      <div className="animate-trustpay-marquee flex w-max gap-10 pr-10 text-sm font-black">
        {[...tickerItems, ...tickerItems].map((item, index) => (
          <span key={`${item}-${index}`} className="whitespace-nowrap">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({
  title,
  text,
}: {
  title: string;
  text?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-3xl font-black leading-tight text-white md:text-4xl">
        {title}
      </h2>
      {text ? <p className="mt-3 text-sm leading-6 text-white/50">{text}</p> : null}
    </div>
  );
}

function MissionSection() {
  return (
    <section className="bg-[#080908] px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[1fr_0.9fr] md:items-center">
        <div className="rounded-xl border border-white/8 bg-[#15151f] p-6 md:p-8">
          <h2 className="text-2xl font-black leading-tight text-white md:text-3xl">
            The story behind TrustPay
          </h2>
          <p className="mt-4 max-w-md text-sm leading-6 text-white/52">
            We make NGN-GHS wallet movement easier to see, confirm, and track.
          </p>
          <div className="mt-5 space-y-3 text-sm text-white/72">
            {["Empower Users", "Foster Financial Inclusion"].map((item) => (
              <p key={item} className="flex items-center gap-2">
                <span className="grid size-5 place-items-center rounded-full bg-red-600 text-[10px] text-white">
                  ✓
                </span>
                {item}
              </p>
            ))}
          </div>
          <Button asChild className="mt-6 rounded-full bg-red-600 text-white hover:bg-red-500">
            <a href="https://wa.me/233555507240?text=Hello%20TrustPay%2C%20I%20want%20to%20get%20started." target="_blank" rel="noreferrer">Get Started on WhatsApp</a>
          </Button>
        </div>

        <div className="relative min-h-[390px] overflow-hidden rounded-xl bg-slate-950">
          <Image
            src="https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&q=85&w=1400"
            alt="Team reviewing digital payment work"
            fill
            unoptimized
            sizes="(min-width: 768px) 45vw, 100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/72 via-black/18 to-transparent" />
          <div className="absolute -bottom-5 -right-2 w-56 rounded-xl border border-white/12 bg-white/92 p-4 text-black shadow-2xl backdrop-blur">
            <ShieldCheck aria-hidden="true" className="size-6 text-red-600" />
            <p className="mt-3 text-sm font-black">Trusted & Secure</p>
            <p className="mt-1 text-xs leading-5 text-black/58">
              Safer wallet movement.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureCards() {
  return (
    <section className="bg-[#0b0b0c] px-4 py-20 sm:px-6 lg:px-8">
      <SectionTitle
        title="The best payment features you won't find anywhere else"
        text="Explore practical wallet features, settings, and support tools built for safer payment operations."
      />
      <div className="mx-auto mt-10 grid max-w-6xl grid-cols-2 gap-3 lg:grid-cols-4">
        {trustCards.map((card, index) => {
          const Icon = card.icon;
          const image = featureImages[index % featureImages.length];

          return (
            <div key={card.title} className="group overflow-hidden rounded-xl border border-white/8 bg-[#202033]">
              <div className="relative aspect-[4/3]">
                <Image
                  src={image.src}
                  alt={image.alt}
                  fill
                  unoptimized
                  sizes="(min-width: 1024px) 25vw, 50vw"
                  className="object-cover transition duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <span className="absolute bottom-3 left-3 grid size-9 place-items-center rounded-full bg-red-600 text-white">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
              </div>
              <div className="p-4">
                <h3 className="text-sm font-semibold text-white md:text-base">{card.title}</h3>
                <p className="mt-1 text-xs leading-5 text-white/50">{card.text}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StoryTimeline() {
  return (
    <section className="bg-[#050505] px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[0.9fr_1.1fr]">
        <div>
          <h2 className="text-3xl font-black leading-tight text-white">
            The story of TrustPay since the beginning
          </h2>
          <p className="mt-4 max-w-md text-sm leading-6 text-white/50">
            TrustPay grew from a simple problem: people needed a clearer way to
            move between wallets, exchange, and everyday bills.
          </p>
          <Button asChild className="mt-6 rounded-full bg-red-600 text-white hover:bg-red-500">
            <Link href="/support">Join Our Team</Link>
          </Button>
        </div>
        <div className="grid gap-4">
          {timeline.map(([number, title, text]) => (
            <div key={number} className="rounded-xl border border-white/8 bg-[#121212] p-5">
              <p className="text-xl font-black text-white/20">{number}</p>
              <h3 className="mt-2 text-base font-semibold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-white/46">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function InsightSection() {
  return (
    <section className="bg-[#050505] px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[0.95fr_1.05fr] md:items-center">
        <div className="rounded-xl bg-gradient-to-br from-red-400 via-red-600 to-white p-4">
          <div className="rounded-lg bg-[#111411] p-4">
            <p className="text-xs text-white/48">Growth</p>
            <p className="mt-2 text-2xl font-black text-white">₦4.8M</p>
            <div className="mt-5 flex h-32 items-end gap-3">
              {[42, 78, 58, 94, 66, 108, 84].map((height) => (
                <span key={height} className="flex-1 rounded-full bg-red-600" style={{ height }} />
              ))}
            </div>
          </div>
        </div>
        <div>
          <h2 className="text-3xl font-black leading-tight text-white">
            Know exactly what is working and what is not.
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-6 text-white/52">
            We intentionally surface performance, status, and support signals so
            teams can understand what happened without digging through noise.
          </p>
          <div className="mt-6 space-y-3 text-sm text-white/72">
            {["Wallet Production Score", "Assured Governance and Compliance"].map((item) => (
              <p key={item} className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-red-500" />
                {item}
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TestimonialSection() {
  return (
    <section className="bg-[linear-gradient(180deg,#06160f,#031009)] px-4 py-20 text-center sm:px-6 lg:px-8">
      <SectionTitle title="What our customers are saying" />
      <div className="mx-auto mt-8 max-w-xl">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-red-600 text-xl font-black text-white">
          TP
        </div>
        <p className="mt-4 font-semibold text-white">Daniel Giri</p>
        <p className="text-xs text-red-400">Digital Marketing Specialist</p>
        <p className="mt-4 text-sm leading-6 text-white/58">
          TrustPay makes money movement feel understandable. Rates, wallet
          activity, and receipts are easy to follow.
        </p>
        <div className="mt-4 flex justify-center gap-1 text-red-400">
          {Array.from({ length: 5 }).map((_, index) => (
            <Star key={index} aria-hidden="true" className="size-4 fill-current" />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <MarketingShell>
      <section className="relative min-h-[680px] overflow-hidden px-4 py-28 sm:px-6 lg:px-8">
        <Image
          src="https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&q=85&w=2200"
          alt=""
          fill
          priority
          unoptimized
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-black/68" />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/72 to-red-950/30" />
        <div className="relative mx-auto flex min-h-[480px] max-w-6xl items-end">
          <div className="max-w-3xl">
            <p className="inline-flex items-center rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-red-100 backdrop-blur">
              About TrustPay
            </p>
            <h1 className="mt-6 max-w-3xl text-5xl font-bold leading-[0.98] tracking-tight text-white md:text-7xl">
              Money movement made clearer.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-white/72">
              NGN-GHS exchange, wallets, VTU, and receipts in one simple flow.
            </p>
            <Button asChild className="mt-7 rounded-full bg-red-600 text-white hover:bg-red-500">
              <a href="https://wa.me/233555507240?text=Hello%20TrustPay%2C%20I%20want%20to%20get%20started." target="_blank" rel="noreferrer">
                Get Started on WhatsApp
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </a>
            </Button>
          </div>
        </div>
      </section>
      <TickerStrip />
      <MissionSection />
      <FeatureCards />
      <StoryTimeline />
      <InsightSection />
      <TestimonialSection />
    </MarketingShell>
  );
}
