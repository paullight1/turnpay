import Link from "next/link";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Banknote,
  FileCheck2,
  Landmark,
  ListChecks,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  WalletCards,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const heroSteps = [
  "Choose NGN or GHS",
  "See the rate before you pay",
  "Get a clear receipt",
];

const operationCards = [
  {
    icon: ListChecks,
    title: "Exchange NGN and GHS",
    text: "See the rate, choose the wallet, and confirm only when the amount looks right.",
    metric: "Clear quote",
  },
  {
    icon: WalletCards,
    title: "Fund your wallet",
    text: "Add money, check your balance, and know when the credit is ready to use.",
    metric: "Live balance",
  },
  {
    icon: ShieldCheck,
    title: "Pay bills faster",
    text: "Buy airtime, data, cable, and electricity from the same wallet flow.",
    metric: "Airtime + bills",
  },
  {
    icon: RefreshCw,
    title: "Track every payment",
    text: "Follow pending, successful, failed, and reversed payments with clear receipts.",
    metric: "Easy receipts",
  },
];

const paymentRows = [
  { name: "Wallet funding", state: "Successful", value: "NGN 75,000" },
  { name: "Exchange", state: "Pending", value: "GHS 420" },
  { name: "Airtime order", state: "Successful", value: "MTN" },
  { name: "Withdrawal", state: "Reversed", value: "NGN 20,000" },
];

function StatusPill({ tone, children }: { tone: string; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    green: "border-emerald-400/30 bg-emerald-400/12 text-emerald-200",
    amber: "border-amber-300/30 bg-amber-300/12 text-amber-100",
    red: "border-rose-400/30 bg-rose-400/12 text-rose-100",
    blue: "border-sky-400/30 bg-sky-400/12 text-sky-100",
  };

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function HeroSection() {
  return (
    <section className="relative isolate min-h-[calc(100svh-1px)] overflow-hidden bg-[#050605] px-4 pb-20 pt-28 text-white sm:px-6 lg:px-8">
      <div className="absolute -left-20 -top-56 -z-10 h-[30rem] w-[calc(100%+10rem)] rounded-[0_0_100%_100%] bg-[radial-gradient(circle_at_45%_50%,#ffd36b_0%,#ff7a18_34%,#dc2f02_58%,rgba(5,6,5,0)_73%)] opacity-90 blur-[2px]" />
      <div className="absolute -right-28 bottom-[-18rem] -z-10 h-[32rem] w-[48rem] rounded-[100%_100%_0_0] bg-[radial-gradient(circle_at_45%_30%,#ffd36b_0%,#ff7a18_35%,#7f1d1d_62%,rgba(5,6,5,0)_74%)] opacity-80 blur-[2px]" />
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_50%_18%,rgba(255,122,24,0.18),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_24%,transparent_72%,rgba(255,122,24,0.08))]" />

      <div className="mx-auto flex max-w-6xl flex-col items-center text-center">
        <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-sm text-white/74 shadow-lg shadow-black/20">
          <span className="rounded-full bg-orange-500 px-2 py-0.5 text-xs font-semibold text-white">
            Wallet
          </span>
          NGN, GHS, bills, and receipts
        </div>

        <h1 className="mt-7 max-w-5xl text-5xl font-semibold leading-[1.02] text-balance md:text-7xl lg:text-8xl">
          Exchange money fast. Pay bills with ease.
        </h1>

        <p className="mt-5 max-w-2xl text-base leading-7 text-white/68 md:text-lg">
          Convert between NGN and GHS, fund your wallet, buy airtime or data,
          and track every payment with a clear receipt.
        </p>

        <div className="mt-8 flex w-full max-w-md flex-col justify-center gap-3 sm:w-auto sm:max-w-none sm:flex-row">
          <Button size="lg" asChild className="bg-orange-500 text-white shadow-lg shadow-orange-950/30 hover:bg-orange-400">
            <Link href="/register">
              Start exchange
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            size="lg"
            variant="outline"
            asChild
            className="border-white/18 bg-white text-black hover:bg-white/90 hover:text-black"
          >
            <Link href="#queue">See wallet features</Link>
          </Button>
        </div>

        <div className="mt-11 flex max-w-3xl flex-wrap items-center justify-center gap-3 text-sm text-white/36">
          {["NGN + GHS", "Wallet funding", "Airtime", "Data", "Bills", "Withdrawals", "Receipts"].map((item) => (
            <span key={item} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">
              {item}
            </span>
          ))}
        </div>

        <div className="mt-10 grid w-full max-w-3xl gap-3 sm:grid-cols-3">
          {heroSteps.map((step, index) => (
            <div
              key={step}
              className="rounded-lg border border-white/10 bg-[#101412]/72 p-4 text-left"
            >
              <span className="text-xs font-semibold text-orange-300">
                Step {index + 1}
              </span>
              <p className="mt-2 text-sm font-medium leading-6 text-white/82">{step}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function OperationsSection() {
  return (
    <section id="queue" className="bg-[#111512] px-4 py-20 text-white sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="flex flex-col gap-5">
          <p className="text-sm text-orange-300">/ 01</p>
          <h2 className="text-3xl font-semibold leading-tight text-balance md:text-5xl">
            Everything starts from your wallet.
          </h2>
          <p className="max-w-md text-base leading-7 text-white/60">
            Fund your balance, exchange NGN and GHS, pay bills, withdraw, and
            keep a receipt for every step.
          </p>
          <Button asChild className="w-fit bg-orange-500 text-white hover:bg-orange-400">
            <Link href="/admin">
              See how it works
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {operationCards.map((card, index) => {
            const Icon = card.icon;

            return (
              <div
                key={card.title}
                className="rounded-lg border border-white/10 bg-white/[0.06] p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="grid size-11 place-items-center rounded-lg bg-orange-500/16 text-orange-200">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <span className="rounded-full bg-orange-500 px-2 py-1 text-xs font-semibold text-white">
                    0{index + 1}
                  </span>
                </div>
                <h3 className="mt-5 text-xl font-semibold">{card.title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/68">{card.text}</p>
                <p className="mt-5 text-sm font-medium text-emerald-300">{card.metric}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function DataSection() {
  return (
    <section className="bg-[#0a0d0b] px-4 py-20 text-white sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
        <div className="flex flex-col gap-5">
          <p className="text-sm text-orange-300">/ 03</p>
          <h2 className="text-3xl font-semibold leading-tight text-balance md:text-5xl">
            Know what happened to your money.
          </h2>
          <p className="max-w-md text-base leading-7 text-white/60">
            Every payment should show a clear status. You can see if it is
            pending, successful, failed, or reversed.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="flex items-end gap-4 rounded-[1.25rem] border border-white/10 bg-white/[0.05] p-5">
            {[
              ["1", "choose a service", "h-36"],
              ["2", "confirm the amount", "h-48"],
              ["3", "track the receipt", "h-60"],
            ].map(([value, label, height]) => (
              <div key={value} className="flex flex-1 flex-col items-center gap-3">
                <p className="text-3xl font-semibold">{value}</p>
                <div className={`${height} w-full rounded-t-[2rem] bg-[radial-gradient(circle_at_50%_30%,#0a0d0b_0%,#0a0d0b_22%,#fb923c_58%,#f97316_100%)]`} />
                <p className="min-h-10 text-center text-xs leading-5 text-white/66">{label}</p>
              </div>
            ))}
          </div>

          <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.05] p-5">
            <div className="flex items-center justify-between">
              <p className="font-medium">Recent payment status</p>
              <Activity aria-hidden="true" className="size-5 text-emerald-300" />
            </div>
            <div className="mt-5 divide-y divide-white/10">
              {paymentRows.map((row) => (
                <div key={row.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-4 text-sm">
                  <span className="text-white/72">{row.name}</span>
                  <StatusPill tone={row.state === "Successful" ? "green" : row.state === "Pending" ? "amber" : row.state === "Reversed" ? "blue" : "red"}>
                    {row.state}
                  </StatusPill>
                  <span className="font-medium">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SecuritySection() {
  return (
    <section className="bg-[#151716] px-4 py-20 text-white sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-5">
          <p className="text-sm text-orange-300">/ 04</p>
          <h2 className="text-3xl font-semibold leading-tight text-balance md:text-5xl">
            Built for admin safety.
          </h2>
          <p className="max-w-lg text-base leading-7 text-white/60">
            The panel should protect users and the business. Sensitive data is
            masked. Money actions are checked. Admin work is logged.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            [LockKeyhole, "Guarded routes", "Only approved admins can open protected tools."],
            [FileCheck2, "Reason capture", "Risky changes need a clear written reason."],
            [Landmark, "Masked bank data", "Show only what support staff truly need."],
            [Banknote, "Ledger first", "Money changes must follow safe ledger records."],
            [UserCheck, "KYC gates", "Limits and reviews follow identity status."],
            [ArrowDownRight, "No double action", "Retries and approvals need idempotency keys."],
          ].map(([Icon, title, text]) => {
            const TileIcon = Icon as typeof LockKeyhole;

            return (
              <div key={title as string} className="rounded-lg border border-white/10 bg-[#0b0e0c]/70 p-5">
                <TileIcon aria-hidden="true" className="size-5 text-orange-300" />
                <h3 className="mt-4 text-lg font-semibold">{title as string}</h3>
                <p className="mt-2 text-sm leading-6 text-white/68">{text as string}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  return (
    <section className="bg-[#080a09] px-4 py-16 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 rounded-[1.25rem] border border-orange-300/25 bg-[linear-gradient(135deg,rgba(249,115,22,0.2),rgba(34,197,94,0.08),rgba(255,255,255,0.04))] p-8 md:p-12">
        <ShieldCheck aria-hidden="true" className="size-10 text-orange-300" />
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold leading-tight text-balance md:text-5xl">
              Give support staff a safer way to work.
            </h2>
            <p className="mt-4 text-base leading-7 text-white/64">
              Replace database edits with queues, review panels, provider checks,
              and audit trails that are easy to use.
            </p>
          </div>
          <Button size="lg" asChild className="bg-orange-500 text-white shadow-lg shadow-orange-950/25 hover:bg-orange-400">
            <Link href="/admin">
              Open admin panel
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
      <OperationsSection />
      <DataSection />
      <SecuritySection />
      <CtaSection />
    </>
  );
}
