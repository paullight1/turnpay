import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Clock3,
  FileCheck2,
  HelpCircle,
  LifeBuoy,
  LockKeyhole,
  MessageSquareText,
  ReceiptText,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Wifi,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Support | TrustPay",
  description:
    "Get simple TrustPay help for account access, KYC, exchange, VTU, transaction status, and receipts.",
};

const supportPaths = [
  {
    icon: LockKeyhole,
    title: "Account access",
    text: "Help with sign in, password reset, phone checks, and locked accounts.",
    action: "Check account",
  },
  {
    icon: FileCheck2,
    title: "KYC and limits",
    text: "Understand why a limit is active and what document is needed next.",
    action: "Review KYC",
  },
  {
    icon: RefreshCw,
    title: "Exchange",
    text: "Check rate, source wallet, target wallet, fee, and final status.",
    action: "View exchange",
  },
  {
    icon: Smartphone,
    title: "Airtime",
    text: "Get help with a phone top-up or pending airtime order.",
    action: "Find order",
  },
  {
    icon: Wifi,
    title: "Data bundles",
    text: "Check a data bundle, provider status, or delivery issue.",
    action: "Find order",
  },
  {
    icon: ReceiptText,
    title: "TV and power",
    text: "Trace cable, TV, electricity, token, and receipt issues.",
    action: "Check bill",
  },
];

const statusGuide = [
  {
    state: "Pending",
    icon: Clock3,
    text: "The request is still moving through a provider or review step.",
    tone: "text-amber-200",
  },
  {
    state: "Successful",
    icon: BadgeCheck,
    text: "The wallet, biller, or bank has confirmed the action.",
    tone: "text-emerald-200",
  },
  {
    state: "Failed",
    icon: ShieldAlert,
    text: "The action did not finish. Support may need the reference to trace it.",
    tone: "text-rose-200",
  },
  {
    state: "Reversed",
    icon: RefreshCw,
    text: "The money was returned after a failed or cancelled action.",
    tone: "text-sky-200",
  },
];

const detailsToShare = [
  "Transaction reference, like TPY-REF-84A2",
  "Amount and currency, like NGN 75,000 or GHS 420",
  "Date and time of the payment",
  "Service type: exchange, airtime, data, TV, or electricity",
  "Masked phone, meter, or customer number, never full secret details",
];

const faqs = [
  {
    question: "Why is my transaction pending?",
    answer:
      "Some payments need provider confirmation. Keep the reference close. Support can use it to trace the status.",
  },
  {
    question: "Why do I need KYC?",
    answer:
      "KYC helps TrustPay set safe limits, reduce fraud, and protect wallet activity.",
  },
  {
    question: "Can support change my balance?",
    answer:
      "No. Support should trace the ledger and provider record. Money changes must follow safe records.",
  },
  {
    question: "What should I never send?",
    answer:
      "Do not send passwords, OTP codes, full card details, or full bank account numbers.",
  },
];

function SupportHero() {
  return (
    <section className="relative isolate overflow-hidden bg-[#080a09] px-4 pb-16 pt-28 text-white trustpay-ledger-bg sm:px-6 lg:px-8">
      <div className="absolute inset-x-0 top-0 -z-10 h-52 bg-[linear-gradient(180deg,rgba(255,107,10,0.24),rgba(16,185,129,0.08),transparent)]" />
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
        <div className="flex flex-col gap-6">
          <div className="flex w-fit items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-sm text-white/70 animate-trustpay-fade-up">
            <LifeBuoy aria-hidden="true" className="size-4 text-orange-300" />
            TrustPay help center
          </div>
          <div className="flex flex-col gap-4">
            <h1 className="text-5xl font-semibold leading-[1.04] text-balance animate-trustpay-fade-up md:text-7xl" style={{ animationDelay: "80ms" }}>
              Get help without guessing.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-white/66 animate-trustpay-fade-up md:text-lg" style={{ animationDelay: "150ms" }}>
              Find the right help for KYC, exchange, VTU, and transaction status.
              Bring your reference so support can trace it fast.
            </p>
          </div>
          <div className="flex flex-col gap-3 animate-trustpay-fade-up sm:flex-row" style={{ animationDelay: "220ms" }}>
            <Button size="lg" asChild className="bg-orange-500 text-white shadow-lg shadow-orange-950/25 hover:bg-orange-400">
              <Link href="/login">
                Sign in for support
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              asChild
              className="border-white/20 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white"
            >
              <Link href="/features">See core features</Link>
            </Button>
          </div>
        </div>

        <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/35 animate-trustpay-fade-up" style={{ animationDelay: "280ms" }}>
          <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <p className="text-xs text-white/60">SUPPORT CASE</p>
              <h2 className="mt-1 text-2xl font-semibold">Exchange is pending</h2>
            </div>
            <span className="rounded-full border border-amber-300/30 bg-amber-300/12 px-3 py-1 text-xs font-medium text-amber-100">
              Pending
            </span>
          </div>
          <div className="mt-5 grid gap-3">
            {[
              ["Reference", "TPY-REF-84A2"],
              ["Amount", "GHS 420"],
              ["Service", "GHS to NGN"],
              ["Next step", "Provider check"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-lg border border-white/10 bg-[#090c0a]/80 p-3 text-sm">
                <span className="text-white/62">{label}</span>
                <span className="font-medium">{value}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-4">
            <p className="text-sm font-medium text-emerald-100">Safe support note</p>
              <p className="mt-2 text-sm leading-6 text-white/68">
              Support can trace the ledger and provider record. They should not ask
              for your password or OTP.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function SupportPage() {
  return (
    <MarketingShell>
      <SupportHero />

      <section className="bg-[#111312] px-4 py-20 text-white sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-10">
          <div className="max-w-3xl">
            <p className="text-sm text-orange-300">/ Support paths</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight text-balance md:text-5xl">
              Pick the problem. See what matters.
            </h2>
            <p className="mt-4 text-base leading-7 text-white/60">
              Each path uses simple words and points users to the detail support
              needs. This keeps help fast and safe.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {supportPaths.map((path) => {
              const Icon = path.icon;

              return (
                <div key={path.title} className="rounded-lg border border-white/10 bg-white/[0.06] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <span className="grid size-11 place-items-center rounded-lg bg-orange-500/16 text-orange-200">
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/66">
                      {path.action}
                    </span>
                  </div>
                  <h3 className="mt-5 text-xl font-semibold">{path.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-white/68">{path.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-[#080a09] px-4 py-20 text-white sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="flex flex-col gap-5">
            <p className="text-sm text-orange-300">/ Status guide</p>
            <h2 className="text-3xl font-semibold leading-tight text-balance md:text-5xl">
              Users should know what the status means.
            </h2>
            <p className="max-w-md text-base leading-7 text-white/60">
              Payment support is calmer when pending, failed, successful, and
              reversed states are explained with plain words.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {statusGuide.map((item) => {
              const Icon = item.icon;

              return (
                <div key={item.state} className="rounded-lg border border-white/10 bg-white/[0.05] p-5">
                  <Icon aria-hidden="true" className={`size-5 ${item.tone}`} />
                  <h3 className="mt-4 text-lg font-semibold">{item.state}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/66">{item.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-[#151716] px-4 py-20 text-white sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.06] p-6">
            <ReceiptText aria-hidden="true" className="size-8 text-orange-300" />
            <h2 className="mt-5 text-3xl font-semibold leading-tight text-balance">
              What to share with support
            </h2>
            <div className="mt-6 grid gap-3">
              {detailsToShare.map((detail) => (
                <div key={detail} className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#090c0a]/70 p-3">
                  <span className="mt-1 size-2 rounded-full bg-emerald-300" aria-hidden="true" />
                  <p className="text-sm leading-6 text-white/66">{detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <p className="text-sm text-orange-300">/ Common questions</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight text-balance">
                Short answers. No hard words.
              </h2>
            </div>
            {faqs.map((item) => (
              <div key={item.question} className="rounded-lg border border-white/10 bg-[#090c0a]/70 p-5">
                <div className="flex items-start gap-3">
                  <HelpCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-orange-300" />
                  <div>
                    <h3 className="text-base font-semibold">{item.question}</h3>
                    <p className="mt-2 text-sm leading-6 text-white/68">{item.answer}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#080a09] px-4 py-16 text-white sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 rounded-[1.25rem] border border-orange-300/25 bg-[linear-gradient(135deg,rgba(249,115,22,0.2),rgba(34,197,94,0.08),rgba(255,255,255,0.04))] p-8 md:p-12">
          <MessageSquareText aria-hidden="true" className="size-10 text-orange-300" />
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="max-w-3xl">
              <h2 className="text-3xl font-semibold leading-tight text-balance md:text-5xl">
                Keep private details private.
              </h2>
              <p className="mt-4 text-base leading-7 text-white/64">
                TrustPay support should never ask for your password, OTP, full card
                number, or full bank details. Use masked data and transaction references.
              </p>
            </div>
            <Button size="lg" asChild className="bg-orange-500 text-white shadow-lg shadow-orange-950/25 hover:bg-orange-400">
              <Link href="/login">
                Sign in safely
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
