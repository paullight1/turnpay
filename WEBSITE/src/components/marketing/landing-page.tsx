import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  Cable,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Flame,
  Gauge,
  Landmark,
  MessageCircle,
  ReceiptText,
  Send,
  ShieldCheck,
  Smartphone,
  Star,
  WalletCards,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { marketingImages } from "@/lib/marketing";

const brandStrip = [
  "TrustFlow",
  "PayLink",
  "NGN-GHS",
  "Wallet",
  "VTU Stack",
  "Rates",
  "Receipts",
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

const stats = [
  ["250+", "Happy Clients"],
  ["90%", "Customer Satisfaction"],
  ["5k", "Successful Payments"],
  ["100%", "Security Controls"],
];

const workSteps = [
  {
    icon: WalletCards,
    title: "Create Wallet",
    text: "Open NGN and GHS balances from one account.",
  },
  {
    icon: CreditCard,
    title: "Fund Account",
    text: "Add money and keep wallet records clean.",
  },
  {
    icon: ReceiptText,
    title: "Register",
    text: "Attach references to each payment attempt.",
  },
  {
    icon: Gauge,
    title: "Start Trading",
    text: "Exchange or pay bills after reviewing the details.",
  },
];

const currencyServices = [
  { label: "Cedis", detail: "GHS wallet", flag: "ghana" },
  { label: "NGN", detail: "Naira currency", flag: "nigeria" },
  { label: "Virtual account", detail: "Local funding", flag: "wallet" },
  { label: "USD accounts", detail: "Dollar-ready", flag: "usd" },
  { label: "Euro", detail: "EUR account", flag: "euro" },
  { label: "Pounds", detail: "GBP account", flag: "gbp" },
];

const networkServices = [
  { label: "MTN", detail: "Airtime + data", tone: "bg-[#ffcc00] text-black" },
  { label: "Glo", detail: "Airtime + data", tone: "bg-[#0f9d42] text-white" },
  { label: "Airtel", detail: "Airtime + data", tone: "bg-[#ed1c24] text-white" },
  { label: "Telecel", detail: "Ghana network", tone: "bg-[#e60000] text-white" },
  { label: "AT", detail: "Ghana network", tone: "bg-[#006bff] text-white" },
  { label: "9mobile", detail: "Airtime + data", tone: "bg-[#b5d334] text-black" },
];

const fastServiceWords = [
  "Fast withdrawal",
  "Fast transfer",
  "Fast airtime",
  "Fast data",
  "Fast receipts",
];

const portfolioSteps = [
  ["01", "Verify your identity", "Complete KYC so wallet limits and review rules are clear."],
  ["02", "Fund your account", "Add money once and move between exchange and utility payments."],
  ["03", "Short trading", "Track pending, successful, reversed, or failed transactions."],
];

const faqs = [
  {
    question: "How do I create an account on TrustPay?",
    answer: "Tap Get Started, add your details, verify your phone, and your NGN and GHS wallet setup can begin.",
  },
  {
    question: "How can I fund my account for bill trading?",
    answer: "Use bank transfer, mobile money, or a supported wallet route. TrustPay keeps the funding record clear before you move money.",
  },
  {
    question: "What services are supported on the TrustPay platform?",
    answer: "TrustPay supports NGN to GHS exchange, wallet funding, airtime, data, bills, receipts, and payment tracking.",
  },
  {
    question: "Does TrustPay show receipts for every money movement?",
    answer: "Yes. Each completed payment or exchange keeps a receipt and reference so you can review it later.",
  },
  {
    question: "How does the advanced algorithm work to optimize wallet trades?",
    answer: "It helps present clear rates, fees, and payment status so users can review the transaction before confirming.",
  },
  {
    question: "Can I use TrustPay on mobile devices?",
    answer: "Yes. TrustPay is designed for mobile users, with app download options and responsive wallet flows.",
  },
];

function GlowToken({
  className,
  icon,
}: {
  className: string;
  icon: React.ReactNode;
}) {
  return (
    <span
      className={`absolute hidden size-12 place-items-center rounded-full border border-orange-300/25 bg-orange-500/16 text-orange-200 shadow-[0_0_34px_rgba(255,107,10,0.38)] md:grid ${className}`}
    >
      {icon}
    </span>
  );
}

function DashboardPreview() {
  const bars = [58, 74, 42, 86, 64, 92, 51];
  const transactions = [
    ["Exchange", "GHS 420", "+4.7%"],
    ["Airtime", "MTN", "+1.2%"],
    ["Electricity", "NGN 20k", "Done"],
  ];

  return (
    <div className="relative mx-auto mt-12 w-full max-w-4xl rounded-xl border border-orange-400/25 bg-[#111411] p-3 shadow-[0_34px_100px_rgba(0,0,0,0.55)]">
      <div className="grid overflow-hidden rounded-lg border border-white/8 bg-[#070907] md:grid-cols-[170px_1fr_190px]">
        <aside className="hidden border-r border-white/8 bg-[#0c120f] p-4 md:block">
          <div className="text-sm font-semibold text-white">TrustPay</div>
          <div className="mt-6 grid gap-2 text-xs text-white/46">
            {["Overview", "Wallets", "Exchange", "VTU", "Receipts"].map((item, index) => (
              <div
                key={item}
                className={`rounded-md px-3 py-2 ${index === 0 ? "bg-orange-500 text-white" : "bg-white/[0.03]"}`}
              >
                {item}
              </div>
            ))}
          </div>
          <div className="mt-16 rounded-lg bg-orange-500/12 p-3 text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-orange-500/22 text-orange-200">
              <WalletCards aria-hidden="true" className="size-6" />
            </div>
            <Button asChild size="sm" className="mt-3 rounded-full bg-orange-500 text-white">
              <Link href="/register">Start</Link>
            </Button>
          </div>
        </aside>

        <div className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-white/44">Analytics</p>
              <h2 className="text-lg font-semibold">Wallet performance</h2>
            </div>
            <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1 text-xs text-orange-200">
              Live rate
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {["NGN", "GHS", "VTU", "Fees"].map((item, index) => (
              <div key={item} className="rounded-lg border border-white/8 bg-white/[0.04] p-3">
                <p className="text-[11px] text-white/42">{item}</p>
                <p className="mt-1 text-sm font-semibold">
                  {index === 0 ? "₦338,060" : index === 1 ? "GH₵4,820" : index === 2 ? "23 paid" : "1.2%"}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-white/8 bg-[#0c0f0c] p-4">
            <div className="flex h-40 items-end gap-3">
              {bars.map((height, index) => (
                <div key={index} className="flex flex-1 items-end rounded-full bg-white/[0.04]">
                  <span
                    className="block w-full rounded-full bg-gradient-to-t from-orange-600 to-orange-300"
                    style={{ height: `${height}%` }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {transactions.map(([label, value, trend]) => (
              <div key={label} className="rounded-lg border border-white/8 bg-white/[0.04] p-3">
                <p className="text-xs text-white/42">{label}</p>
                <p className="mt-1 text-sm font-semibold">{value}</p>
                <p className="mt-2 text-xs text-orange-300">{trend}</p>
              </div>
            ))}
          </div>
        </div>

        <aside className="border-t border-white/8 bg-[#0b0e0b] p-4 md:border-l md:border-t-0">
          <p className="text-xs text-white/42">Balance</p>
          <p className="mt-1 text-xl font-semibold">₦338,060.20</p>
          <div className="mt-5 space-y-3">
            {["Pending", "Completed", "Reversed"].map((item, index) => (
              <div key={item} className="flex items-center justify-between rounded-lg bg-white/[0.04] p-3 text-xs">
                <span className="text-white/54">{item}</span>
                <span className={index === 0 ? "text-orange-300" : "text-white"}>{index + 2}</span>
              </div>
            ))}
          </div>
          <Button asChild className="mt-5 w-full rounded-full bg-orange-500 text-white hover:bg-orange-400">
            <Link href="/dashboard">Open app</Link>
          </Button>
        </aside>
      </div>
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  text,
}: {
  eyebrow?: string;
  title: string;
  text?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">{eyebrow}</p> : null}
      <h2 className="mt-3 text-3xl font-bold leading-tight text-white md:text-4xl">{title}</h2>
      {text ? <p className="mt-3 text-sm leading-6 text-white/50">{text}</p> : null}
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden px-4 pb-16 pt-28 sm:px-6 lg:px-8">
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_50%_0%,rgba(255,107,10,0.18),transparent_34%),linear-gradient(180deg,#07100c_0%,#050605_52%,#020302_100%)]" />
      <div className="absolute inset-x-0 top-16 -z-10 h-px bg-gradient-to-r from-transparent via-orange-400/50 to-transparent" />
      <GlowToken className="left-[6%] top-72" icon={<Banknote className="size-5" />} />
      <GlowToken className="right-[16%] top-36" icon={<Zap className="size-5" />} />
      <GlowToken className="left-[18%] top-[23rem]" icon={<ShieldCheck className="size-5" />} />
      <GlowToken className="right-[10%] top-[25rem]" icon={<ReceiptText className="size-5" />} />

      <div className="mx-auto max-w-5xl text-center">
        <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/64">
          <span className="rounded-full bg-orange-500 px-2 py-0.5 font-semibold text-white">
            Wallet
          </span>
          Secure NGN, GHS, and VTU payments
        </p>
        <h1 className="mx-auto mt-6 max-w-4xl text-5xl font-black leading-[0.96] tracking-[-0.02em] text-white md:text-7xl">
          Naira To <em className="text-orange-400">Cedis</em> Made Simple
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-sm leading-6 text-white/58 md:text-base">
          Exchange money and manage payments with a wallet built for you.
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          <Button asChild className="h-10 rounded-full bg-orange-500 px-4 text-white hover:bg-orange-400 sm:px-5">
            <Link href="/register">
              Get Started
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-10 rounded-full border-white/12 bg-white/[0.04] px-4 text-white hover:bg-white hover:text-black sm:px-5">
            <Link href="/exchange">Exchange now</Link>
          </Button>
        </div>
      </div>

      <div className="hidden md:block">
        <div className="hidden md:block">
          <DashboardPreview />
        </div>
      </div>
    </section>
  );
}

function BrandStrip() {
  return (
    <div className="overflow-hidden border-y border-black bg-orange-400 py-3 text-black">
      <div className="animate-trustpay-marquee flex w-max gap-10 pr-10 text-sm font-black">
        {[...brandStrip, ...brandStrip].map((item, index) => (
          <span key={`${item}-${index}`} className="whitespace-nowrap">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function TrustedBanksSection() {
  const firstRow = trustedBanks.slice(0, 6);
  const secondRow = trustedBanks.slice(6);

  return (
    <section className="bg-[#050505] px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-black leading-tight text-white md:text-4xl">
            Trusted banks
          </h2>
          <p className="mt-3 text-sm leading-6 text-white/50">
            TRUSTPAY is built to feel familiar and reliable across Nigerian and
            Ghanaian money movement, bank funding, mobile money, and wallet flows.
          </p>
        </div>

        <div className="relative mt-10 overflow-hidden rounded-xl border border-white/8 bg-[#0b0d0b] py-5">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-14 bg-gradient-to-r from-[#0b0d0b] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-14 bg-gradient-to-l from-[#0b0d0b] to-transparent" />
          <div className="animate-trustpay-marquee flex w-max gap-4 pr-4 [animation-duration:30s]">
            {[...firstRow, ...firstRow].map((bank, index) => (
              <div
                key={`${bank.name}-${index}`}
                className="flex min-w-[240px] items-center gap-3 px-4 py-3"
              >
                <span className="grid h-12 w-24 place-items-center overflow-hidden rounded-lg bg-white p-1.5">
                  <Image
                    src={bank.src}
                    alt={`${bank.name} logo`}
                    width={96}
                    height={48}
                    className="max-h-10 w-full object-contain"
                  />
                </span>
                <span>
                  <span className="block text-sm font-black text-white">{bank.name}</span>
                  <span className="block text-xs text-white/42">{bank.market}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="animate-trustpay-marquee-reverse mt-4 flex w-max gap-4 pr-4 [animation-duration:34s]">
            {[...secondRow, ...secondRow].map((bank, index) => (
              <div
                key={`${bank.name}-${index}`}
                className="flex min-w-[240px] items-center gap-3 px-4 py-3"
              >
                <span className="grid h-12 w-24 place-items-center overflow-hidden rounded-lg bg-white p-1.5">
                  <Image
                    src={bank.src}
                    alt={`${bank.name} logo`}
                    width={96}
                    height={48}
                    className="max-h-10 w-full object-contain"
                  />
                </span>
                <span>
                  <span className="block text-sm font-black text-white">{bank.name}</span>
                  <span className="block text-xs text-white/42">{bank.market}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ExchangePlusSection() {
  return (
    <section className="bg-[#050505] px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-5xl gap-5 rounded-xl border border-white/8 bg-[#1a1a28] p-4 md:grid-cols-[260px_1fr] md:p-5">
        <div className="rounded-lg bg-gradient-to-br from-orange-300 via-orange-400 to-white p-5 text-black">
          <p className="text-2xl font-black leading-tight">TrustPay app</p>
          <p className="mt-2 text-xs font-semibold text-black/68">
            Swap money, buy airtime, pay bills, and get a virtual account in one simple app.
          </p>
          <Button asChild className="mt-5 rounded-full bg-white text-black hover:bg-black hover:text-white">
            <Link href="/download">Download</Link>
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {[
            ["01", "Swap money", "Change naira to cedis and see the rate first."],
            ["02", "Buy airtime & data", "Top up your phone for MTN, Airtel, Glo, and more."],
            ["03", "Pay bills", "Pay electricity and other bills from your wallet."],
            ["04", "Get virtual account", "Receive money into your TrustPay wallet."],
          ].map(([number, title, text]) => (
            <div key={number} className="flex gap-3 rounded-lg bg-white/[0.03] p-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-black text-sm font-bold text-white">
                {number}
              </span>
              <div>
                <h3 className="text-sm font-semibold text-white">{title}</h3>
                <p className="mt-1 text-xs leading-5 text-white/44">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatsSection() {
  return (
    <section className="bg-[#050605] px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1fr_1fr] md:items-center">
        <div>
          <h2 className="text-3xl font-bold leading-tight text-white md:text-4xl">
            Our statistics over the years
          </h2>
          <p className="mt-4 max-w-md text-sm leading-6 text-white/48">
            Follow our operation growth journey over the years through key
            achievements in wallet usage, transaction reliability, and support.
          </p>
          <div className="mt-8 space-y-4">
            {stats.map(([value, label]) => (
              <div key={label} className="grid grid-cols-[120px_1fr] items-center gap-4 sm:grid-cols-[150px_1fr]">
                <span className="text-4xl font-black leading-none text-orange-300 sm:text-5xl">{value}</span>
                <span className="border-b border-white/10 pb-3 text-sm text-white/56 sm:text-base">{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="relative mx-auto hidden w-full max-w-md md:block">
          <div className="rounded-xl border border-white/10 bg-white p-4 text-black shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            {["Balance", "Difference", "NGN/GHS"].map((item, index) => (
              <div key={item} className="mb-3 flex items-center justify-between rounded-lg bg-[#f5f5f5] p-3 text-sm">
                <span className="flex items-center gap-2 font-semibold">
                  <span className="grid size-7 place-items-center rounded-full bg-orange-500 text-xs text-white">
                    {index + 1}
                  </span>
                  {item}
                </span>
                <span className="text-orange-600">+{index + 2}.7%</span>
              </div>
            ))}
          </div>
          <div className="absolute -bottom-8 -left-6 rounded-xl border border-white/10 bg-white p-3 text-black shadow-xl">
            <p className="text-xs text-black/52">Today</p>
            <p className="mt-1 text-lg font-black">₦545.23</p>
            <div className="mt-2 h-12 w-28 rounded-lg bg-[linear-gradient(135deg,#ff6b0a_0%,#111_48%,#ffb36a_100%)]" />
          </div>
        </div>
      </div>
    </section>
  );
}

function WorksSection() {
  return (
    <section className="bg-[#050505] px-4 py-20 md:bg-[linear-gradient(180deg,#06160f,#04100b)] sm:px-6 lg:px-8">
      <SectionTitle
        title="How It Works"
        text="Discover how TrustPay simplifies money trading through user-friendly interfaces, secure transactions, and real-time wallet insights."
      />
      <div className="mx-auto mt-10 grid max-w-3xl gap-3 sm:gap-4">
        {workSteps.map((step) => {
          const Icon = step.icon;

          return (
            <div key={step.title} className="rounded-lg border border-white/10 bg-[#071c2d] p-3 sm:p-5">
              <span className="grid size-9 place-items-center rounded-full bg-orange-500 text-white sm:size-10">
                <Icon aria-hidden="true" className="size-4 sm:size-5" />
              </span>
              <h3 className="mt-4 text-sm font-semibold leading-tight text-white sm:text-base">{step.title}</h3>
              <p className="mt-2 text-[11px] leading-5 text-white/56 sm:text-xs">{step.text}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MiniFlag({ type }: { type: string }) {
  if (type === "ghana") {
    return (
      <span className="grid size-12 overflow-hidden rounded-2xl border border-white/20 shadow-[inset_0_2px_8px_rgba(255,255,255,0.28),0_12px_28px_rgba(0,0,0,0.38)]">
        <span className="bg-[#ef3340]" />
        <span className="bg-[#fcd116]" />
        <span className="bg-[#009739]" />
      </span>
    );
  }

  if (type === "nigeria") {
    return (
      <span className="grid size-12 grid-cols-3 overflow-hidden rounded-2xl border border-white/20 shadow-[inset_0_2px_8px_rgba(255,255,255,0.28),0_12px_28px_rgba(0,0,0,0.38)]">
        <span className="bg-[#008751]" />
        <span className="bg-white" />
        <span className="bg-[#008751]" />
      </span>
    );
  }

  const currencyTiles: Record<string, { symbol: string; className: string }> = {
    euro: {
      symbol: "€",
      className: "border-blue-200/30 bg-[linear-gradient(145deg,#1f6cff_0%,#1737a8_58%,#071a55_100%)] text-yellow-300",
    },
    gbp: {
      symbol: "£",
      className: "border-red-200/30 bg-[linear-gradient(145deg,#ffffff_0%,#2458b8_42%,#c8102e_100%)] text-white",
    },
    usd: {
      symbol: "$",
      className: "border-emerald-200/30 bg-[linear-gradient(145deg,#ffffff_0%,#2f9d67_46%,#113d2b_100%)] text-white",
    },
    wallet: {
      symbol: "VA",
      className: "border-cyan-200/25 bg-[linear-gradient(145deg,#eef7ff_0%,#264a73_46%,#081829_100%)] text-white",
    },
  };
  const tile = currencyTiles[type] ?? {
    symbol: "TP",
    className: "border-white/20 bg-[linear-gradient(145deg,#f8fafc_0%,#334155_52%,#020617_100%)] text-white",
  };

  return (
    <span className={`grid size-12 place-items-center rounded-2xl border text-xl font-black shadow-[inset_0_2px_8px_rgba(255,255,255,0.35),0_14px_28px_rgba(0,0,0,0.38)] ${tile.className}`}>
      <span className="drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)]">{tile.symbol}</span>
    </span>
  );
}

function CurrencyServicePill({
  service,
}: {
  service: (typeof currencyServices)[number];
}) {
  return (
    <div className="flex min-w-[250px] items-center gap-4 rounded-full border border-white/8 bg-[#121512] px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.25)]">
      <MiniFlag type={service.flag} />
      <span>
        <span className="block text-sm font-black text-white">{service.label}</span>
        <span className="block text-xs text-white/44">{service.detail}</span>
      </span>
    </div>
  );
}

function NetworkServicePill({
  service,
}: {
  service: (typeof networkServices)[number];
}) {
  return (
    <div className="flex min-w-[220px] items-center gap-3 rounded-full border border-white/8 bg-[#141421] px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.25)]">
      <span className={`grid size-12 place-items-center rounded-2xl text-xs font-black shadow-[inset_0_2px_8px_rgba(255,255,255,0.22),0_12px_26px_rgba(0,0,0,0.35)] ${service.tone}`}>
        {service.label}
      </span>
      <span>
        <span className="block text-sm font-black text-white">{service.label}</span>
        <span className="block text-xs text-white/44">{service.detail}</span>
      </span>
    </div>
  );
}

function ServicesSection() {
  return (
    <section className="bg-[#050505] px-4 py-20 sm:px-6 lg:px-8">
      <SectionTitle
        title="Popular TrustPay services"
        text="Explore a variety of payment operations on our platform, empowering you to diversify your wallet and move smarter."
      />
      <div className="mx-auto mt-10 max-w-6xl overflow-hidden rounded-xl border border-white/8 bg-[#080908] py-5">
        <div className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-[#080908] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-[#080908] to-transparent" />
          <div className="animate-trustpay-marquee flex w-max gap-4 pr-4 [animation-duration:24s]">
            {[...currencyServices, ...currencyServices].map((service, index) => (
              <CurrencyServicePill key={`${service.label}-${index}`} service={service} />
            ))}
          </div>
        </div>

        <div className="relative mt-4 overflow-hidden">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-[#080908] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-[#080908] to-transparent" />
          <div className="animate-trustpay-marquee-reverse flex w-max gap-4 pr-4 [animation-duration:28s]">
            {[...networkServices, ...networkServices].map((service, index) => (
              <NetworkServicePill key={`${service.label}-${index}`} service={service} />
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-3xl rounded-xl border border-orange-400/20 bg-[radial-gradient(circle_at_50%_0%,rgba(255,107,10,0.18),transparent_34%),#090b09] p-6 text-center sm:p-8">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-orange-500 text-white shadow-[0_0_30px_rgba(255,107,10,0.35)]">
          <Landmark aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">
          Always ready
        </p>
        <h3 className="mt-2 text-2xl font-black text-white">
          <span className="trustpay-fast-words" aria-label="Fast withdrawal, fast transfer, fast airtime, fast data, fast receipts">
            {fastServiceWords.map((word) => (
              <span key={word}>{word}</span>
            ))}
          </span>
        </h3>
        <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-white/52">
          Withdrawals stay steady while the service promise changes around the
          user: transfer, airtime, data, and receipt flows all stay quick.
        </p>
        <Button asChild variant="outline" className="mt-5 rounded-full border-orange-400/30 bg-transparent text-orange-200 hover:bg-orange-500 hover:text-white">
          <Link href="/register">Start now</Link>
        </Button>
      </div>
    </section>
  );
}

function PortfolioSection() {
  return (
    <section className="bg-[#050505] px-4 py-16 sm:px-6 lg:px-8">
      <SectionTitle title="Create your payment portfolio today" text="Start building your TrustPay profile safely, using clear rates, wallet limits, and real transaction records." />
      <div className="mx-auto mt-10 grid max-w-6xl gap-8 md:grid-cols-[0.9fr_1.1fr] md:items-center">
        <div className="space-y-5">
          {portfolioSteps.map(([number, title, text]) => (
            <div key={number} className="grid grid-cols-[42px_1fr] gap-4">
              <span className="grid size-10 place-items-center rounded-md border border-orange-400/40 text-sm font-bold text-orange-200">
                {number}
              </span>
              <div>
                <h3 className="text-base font-semibold text-white">{title}</h3>
                <p className="mt-1 text-xs leading-5 text-white/46">{text}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden md:block">
          <DashboardPreview />
        </div>
      </div>
    </section>
  );
}

function TestimonialSection() {
  return (
    <section className="bg-[linear-gradient(180deg,#06160f,#031009)] px-4 py-20 text-center sm:px-6 lg:px-8">
      <SectionTitle title="What our customers are saying" />
      <div className="mx-auto mt-8 flex max-w-4xl items-center justify-between gap-6">
        <button type="button" aria-label="Previous testimonial" className="grid size-9 place-items-center rounded-full bg-white/8 text-white/70">
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <div className="max-w-xl">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-orange-500 text-xl font-black text-white">
            TP
          </div>
          <p className="mt-4 font-semibold text-white">Daniel Giri</p>
          <p className="text-xs text-orange-300">Digital Marketing Specialist</p>
          <p className="mt-4 text-sm leading-6 text-white/58">
            The platform is user-friendly and secure, with real-time wallet
            insights that make payment tracking simple.
          </p>
          <div className="mt-4 flex justify-center gap-1 text-orange-300">
            {Array.from({ length: 5 }).map((_, index) => (
              <Star key={index} aria-hidden="true" className="size-4 fill-current" />
            ))}
          </div>
        </div>
        <button type="button" aria-label="Next testimonial" className="grid size-9 place-items-center rounded-full bg-white/8 text-white/70">
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      </div>
    </section>
  );
}

function IntegrationsSection() {
  return (
    <section className="bg-[#050505] px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl text-center">
        <div className="mx-auto grid max-w-xl grid-cols-5 gap-5 text-orange-300">
          {[MessageCircle, Send, Smartphone, Flame, Cable].map((Icon, index) => (
            <span key={index} className="grid size-11 place-items-center rounded-full bg-white/[0.05]">
              <Icon aria-hidden="true" className="size-5" />
            </span>
          ))}
        </div>
        <h2 className="mt-8 text-3xl font-bold text-white">
          Integrated with most popular payment currencies
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/50">
          Experience seamless TrustPay with Ghana integrations of the most
          popular payment rails.
        </p>
        <Button asChild className="mt-6 rounded-full bg-orange-500 text-white hover:bg-orange-400">
          <Link href="/support">Explore</Link>
        </Button>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section className="bg-[#050505] px-4 pb-16 sm:px-6 lg:px-8">
      <SectionTitle
        title="Frequently Asked Questions"
        text="Find answers to common questions in our comprehensive FAQ section, providing clarity and support for your payment journey."
      />
      <div className="mx-auto mt-8 grid max-w-5xl gap-4 md:grid-cols-2">
        {faqs.map((faq) => (
          <details key={faq.question} className="group rounded-lg border border-white/8 bg-[#181824] text-sm leading-6 text-white sm:text-base">
            <summary className="flex min-h-[72px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 marker:hidden sm:min-h-[84px] sm:px-6 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">{faq.question}</span>
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-orange-500 text-sm text-white transition-transform duration-200 group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="border-t border-white/8 px-5 pb-5 pt-4 text-white/56 sm:px-6">
              {faq.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

function DownloadSection() {
  return (
    <section className="bg-[#050505] px-4 pb-20 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-5xl overflow-hidden rounded-xl border border-white/10 bg-[#07131f] text-white md:grid-cols-[0.9fr_1.1fr]">
        <div className="relative min-h-[320px]">
          <Image
            src={marketingImages.exchangeApp.src}
            alt="TrustPay mobile experience"
            fill
            sizes="(min-width: 768px) 40vw, 100vw"
            className="object-cover opacity-70"
          />
          <div className="absolute inset-0 bg-black/28" />
        </div>
        <div className="p-8 md:p-12">
          <h2 className="text-4xl font-black leading-tight">
            Download and enjoy the experience
          </h2>
          <p className="mt-4 text-sm leading-6 text-white/60">
            Do not miss out. Download our app and simplify your exchange, wallet,
            and bill payments in seconds.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild className="rounded-full bg-orange-500 px-5 text-white hover:bg-orange-400">
              <Link href="/download">Download</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingPage() {
  return (
    <>
      <HeroSection />
      <BrandStrip />
      <TrustedBanksSection />
      <ExchangePlusSection />
      <StatsSection />
      <WorksSection />
      <ServicesSection />
      <PortfolioSection />
      <TestimonialSection />
      <IntegrationsSection />
      <FaqSection />
      <DownloadSection />
    </>
  );
}
