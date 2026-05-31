import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  CircleDollarSign,
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
    text: "Financial actions are shaped around guarded sessions, clear checks, and safer retries.",
  },
  {
    icon: BadgeCheck,
    title: "Automatically Clear",
    text: "Every important action keeps the rate, amount, fee, status, and reference visible.",
  },
  {
    icon: BarChart3,
    title: "Trade Algorithm",
    text: "Wallet and exchange flows prioritize readable quotes before users approve.",
  },
  {
    icon: Headphones,
    title: "24/7 Support",
    text: "Support starts from a transaction reference, not vague payment complaints.",
  },
];

const timeline = [
  ["01", "Wallet Rails", "NGN and GHS wallets became the base for account activity."],
  ["02", "Secure Controls", "KYC, auth, and payment checks became core product surfaces."],
  ["03", "VTU Expansion", "Airtime, data, TV, and electricity joined the wallet workflow."],
];

function TickerStrip() {
  return (
    <div className="overflow-hidden border-y border-black bg-orange-400 py-3 text-black">
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

function HeroGraphic() {
  return (
    <div className="relative mx-auto h-64 w-full max-w-md md:h-80">
      <div className="absolute right-8 top-4 grid size-24 place-items-center rounded-full border border-orange-200/40 bg-gradient-to-br from-orange-300 to-orange-600 text-black shadow-[0_0_55px_rgba(255,107,10,0.42)]">
        <CircleDollarSign aria-hidden="true" className="size-11" />
      </div>
      <div className="absolute bottom-4 right-4 flex items-end gap-3">
        {[116, 158, 204, 248].map((height) => (
          <div
            key={height}
            className="w-14 rounded-t-lg border border-black/20 bg-gradient-to-br from-orange-300 via-orange-400 to-white shadow-[0_18px_45px_rgba(0,0,0,0.35)]"
            style={{ height: `${height}px` }}
          >
            <div className="h-full rounded-t-lg bg-white/12" />
          </div>
        ))}
      </div>
      <div className="absolute bottom-8 left-2 rounded-xl border border-orange-400/30 bg-[#111411] p-4 shadow-2xl">
        <p className="text-xs text-white/44">Settlement health</p>
        <p className="mt-1 text-2xl font-black text-white">99.8%</p>
        <div className="mt-3 h-2 w-32 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-[78%] rounded-full bg-orange-500" />
        </div>
      </div>
    </div>
  );
}

function MissionSection() {
  return (
    <section className="bg-[#080908] px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[1fr_0.9fr] md:items-center">
        <div className="rounded-xl border border-white/8 bg-[#15151f] p-6 md:p-8">
          <h2 className="text-2xl font-black leading-tight text-white md:text-3xl">
            The story and mission behind our company
          </h2>
          <p className="mt-4 text-sm leading-6 text-white/52">
            TrustPay exists to make wallet movement, NGN/GHS exchange, and VTU
            payments easier to understand. We focus on clear records,
            confirmation moments, and support-ready references.
          </p>
          <div className="mt-5 space-y-3 text-sm text-white/72">
            {["Empower Users", "Foster Financial Inclusion"].map((item) => (
              <p key={item} className="flex items-center gap-2">
                <span className="grid size-5 place-items-center rounded-full bg-orange-500 text-[10px] text-white">
                  ✓
                </span>
                {item}
              </p>
            ))}
          </div>
          <Button asChild className="mt-6 rounded-full bg-orange-500 text-white hover:bg-orange-400">
            <Link href="/register">Join Our Team</Link>
          </Button>
        </div>

        <div className="relative min-h-[360px] rounded-xl bg-gradient-to-br from-orange-300 via-orange-500 to-white">
          <div className="absolute -bottom-5 -right-2 w-56 rounded-xl border border-white/12 bg-white p-4 text-black shadow-2xl">
            <ShieldCheck aria-hidden="true" className="size-6 text-orange-600" />
            <p className="mt-3 text-sm font-black">Trusted & Secure</p>
            <p className="mt-1 text-xs leading-5 text-black/58">
              Enhance the peace of mind with our secure platform.
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
        {trustCards.map((card) => {
          const Icon = card.icon;

          return (
            <div key={card.title} className="rounded-lg border border-white/8 bg-[#202033] p-4 text-center md:p-5">
              <span className="mx-auto grid size-10 place-items-center rounded-full bg-orange-500/16 text-orange-300">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <h3 className="mt-4 text-sm font-semibold text-white md:text-base">{card.title}</h3>
              <p className="mt-2 text-[11px] leading-5 text-white/50 md:text-xs">{card.text}</p>
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
          <Button asChild className="mt-6 rounded-full bg-orange-500 text-white hover:bg-orange-400">
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
        <div className="rounded-xl bg-gradient-to-br from-orange-300 via-orange-500 to-white p-4">
          <div className="rounded-lg bg-[#111411] p-4">
            <p className="text-xs text-white/48">Growth</p>
            <p className="mt-2 text-2xl font-black text-white">₦4.8M</p>
            <div className="mt-5 flex h-32 items-end gap-3">
              {[42, 78, 58, 94, 66, 108, 84].map((height) => (
                <span key={height} className="flex-1 rounded-full bg-orange-500" style={{ height }} />
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
                <span className="size-2 rounded-full bg-orange-400" />
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
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-orange-500 text-xl font-black text-white">
          TP
        </div>
        <p className="mt-4 font-semibold text-white">Daniel Giri</p>
        <p className="text-xs text-orange-300">Digital Marketing Specialist</p>
        <p className="mt-4 text-sm leading-6 text-white/58">
          TrustPay makes money movement feel understandable. Rates, wallet
          activity, and receipts are easy to follow.
        </p>
        <div className="mt-4 flex justify-center gap-1 text-orange-300">
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
      <section className="relative overflow-hidden px-4 pb-16 pt-28 sm:px-6 lg:px-8">
        <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_60%_20%,rgba(255,107,10,0.18),transparent_34%),linear-gradient(180deg,#050605_0%,#080908_58%,#050505_100%)]" />
        <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1fr_0.85fr] md:items-center">
          <div>
            <h1 className="max-w-2xl text-5xl font-black leading-[0.98] tracking-[-0.02em] text-white md:text-6xl">
              Tale of Money: Embracing the Future of TrustPay
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-6 text-white/56 md:text-base">
              Every wallet tells a story. TrustPay helps users exchange NGN and
              GHS, pay everyday bills, and keep proof without losing clarity.
            </p>
            <Button asChild className="mt-7 rounded-full bg-orange-500 text-white hover:bg-orange-400">
              <Link href="/register">
                Start Now
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <HeroGraphic />
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
