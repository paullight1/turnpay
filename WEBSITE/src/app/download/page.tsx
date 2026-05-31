import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  FileDown,
  Fingerprint,
  LockKeyhole,
  QrCode,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  Store,
  WalletCards,
  Zap,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Download | TrustPay",
  description:
    "Download the TrustPay mobile app from app stores or get the Android APK for wallet, exchange, and VTU payments.",
};

const downloadOptions = [
  {
    icon: Store,
    label: "App Store",
    title: "Download for iPhone",
    text: "Install TrustPay on iOS for wallet balances, exchange quotes, VTU payments, and receipts.",
    href: "/support",
    action: "Get iOS link",
  },
  {
    icon: Smartphone,
    label: "Google Play",
    title: "Download for Android",
    text: "Get the Android app from Google Play when you prefer store-managed updates.",
    href: "/support",
    action: "Get Play link",
  },
  {
    icon: FileDown,
    label: "APK",
    title: "Download Android APK",
    text: "Use the APK option when the Play Store is unavailable in your region or on your device.",
    href: "#apk-safety",
    action: "View APK steps",
  },
];

const phoneRows = [
  ["NGN Wallet", "₦338,060"],
  ["GHS Wallet", "GH₵4,820"],
  ["Pending VTU", "2"],
  ["Receipts", "Ready"],
];

const safetyItems = [
  {
    icon: ShieldCheck,
    title: "Verify before install",
    text: "Only install APK files from TrustPay-controlled links or official support messages.",
  },
  {
    icon: LockKeyhole,
    title: "Protect your session",
    text: "Never share OTPs, passwords, transaction PINs, or recovery codes during installation.",
  },
  {
    icon: BadgeCheck,
    title: "Keep updates current",
    text: "Install the latest app version so wallet, exchange, and VTU flows stay current.",
  },
];

const appFeatures = [
  ["Multi-currency wallets", WalletCards],
  ["Exchange NGN and GHS", Zap],
  ["VTU and bill payments", Smartphone],
  ["Receipts and references", ReceiptText],
];

function PhoneMockup() {
  return (
    <div className="relative mx-auto w-full max-w-[330px]">
      <div className="absolute -inset-8 rounded-full bg-orange-500/20 blur-3xl" />
      <div className="relative rounded-[2.25rem] border border-orange-400/30 bg-[#0a0c0a] p-3 shadow-[0_32px_100px_rgba(0,0,0,0.62)]">
        <div className="rounded-[1.75rem] border border-white/8 bg-[#111411] p-4">
          <div className="mx-auto h-1.5 w-16 rounded-full bg-white/18" />
          <div className="mt-6 flex items-center justify-between">
            <div>
              <p className="text-xs text-white/42">TrustPay mobile</p>
              <h2 className="text-xl font-black text-white">Wallet Home</h2>
            </div>
            <span className="grid size-10 place-items-center rounded-full bg-orange-500 text-white">
              <ShieldCheck aria-hidden="true" className="size-5" />
            </span>
          </div>
          <div className="mt-6 rounded-2xl bg-gradient-to-br from-orange-300 via-orange-500 to-white p-4 text-black">
            <p className="text-xs font-semibold text-black/60">Available balance</p>
            <p className="mt-1 text-2xl font-black">₦338,060.20</p>
            <div className="mt-5 flex gap-2">
              <span className="rounded-full bg-black px-3 py-1 text-xs text-white">Exchange</span>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold">VTU</span>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {phoneRows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-xl bg-white/[0.05] px-4 py-3">
                <span className="text-sm text-white/58">{label}</span>
                <span className="text-sm font-semibold text-white">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DownloadBadge({
  title,
  subtitle,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  icon: typeof Store;
}) {
  return (
    <span className="inline-flex min-w-[150px] items-center gap-3 rounded-full border border-white/12 bg-white/[0.06] px-4 py-3 text-left transition-colors hover:border-orange-300/50 hover:bg-orange-500/12">
      <Icon aria-hidden="true" className="size-5 text-orange-300" />
      <span>
        <span className="block text-[11px] leading-none text-white/44">{subtitle}</span>
        <span className="mt-1 block text-sm font-semibold text-white">{title}</span>
      </span>
    </span>
  );
}

function SectionTitle({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-3xl font-black leading-tight text-white md:text-4xl">
        {title}
      </h2>
      <p className="mt-3 text-sm leading-6 text-white/50">{text}</p>
    </div>
  );
}

export default function DownloadPage() {
  return (
    <MarketingShell>
      <section className="relative overflow-hidden px-4 pb-20 pt-28 sm:px-6 lg:px-8">
        <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_52%_18%,rgba(255,107,10,0.2),transparent_32%),linear-gradient(180deg,#050605_0%,#080908_58%,#050505_100%)]" />
        <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-[1fr_0.85fr] md:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/64">
              <span className="rounded-full bg-orange-500 px-2 py-0.5 font-semibold text-white">
                Mobile app
              </span>
              App stores or APK
            </p>
            <h1 className="mt-6 max-w-3xl text-5xl font-black leading-[0.96] tracking-[-0.02em] text-white md:text-7xl">
              Download TrustPay and move money clearly.
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-6 text-white/56 md:text-base">
              Install TrustPay on your phone to exchange NGN and GHS, pay VTU
              services, review wallet activity, and keep receipts close.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="#download-options">
                <DownloadBadge icon={Store} subtitle="Download on the" title="App Store" />
              </Link>
              <Link href="#download-options">
                <DownloadBadge icon={Smartphone} subtitle="Get it on" title="Google Play" />
              </Link>
              <Link href="#apk-safety">
                <DownloadBadge icon={FileDown} subtitle="Direct install" title="Android APK" />
              </Link>
            </div>
          </div>
          <PhoneMockup />
        </div>
      </section>

      <section id="download-options" className="bg-[#050505] px-4 py-20 sm:px-6 lg:px-8">
        <SectionTitle
          title="Choose your download path"
          text="Use the store that fits your device, or follow the APK path when store access is not available."
        />
        <div className="mx-auto mt-10 grid max-w-6xl gap-4 md:grid-cols-3">
          {downloadOptions.map((option) => {
            const Icon = option.icon;

            return (
              <div key={option.title} className="rounded-xl border border-white/8 bg-[#171722] p-5">
                <span className="grid size-12 place-items-center rounded-full bg-orange-500 text-white">
                  <Icon aria-hidden="true" className="size-6" />
                </span>
                <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">
                  {option.label}
                </p>
                <h2 className="mt-2 text-xl font-black text-white">{option.title}</h2>
                <p className="mt-3 text-sm leading-6 text-white/52">{option.text}</p>
                <Button asChild className="mt-6 rounded-full bg-orange-500 text-white hover:bg-orange-400">
                  <Link href={option.href}>
                    {option.action}
                    <ArrowRight data-icon="inline-end" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-[#080908] px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-8 rounded-xl border border-white/8 bg-[#111411] p-5 md:grid-cols-[0.85fr_1.15fr] md:p-8">
          <div className="rounded-xl bg-gradient-to-br from-orange-300 via-orange-500 to-white p-5 text-black">
            <QrCode aria-hidden="true" className="size-10" />
            <h2 className="mt-16 text-3xl font-black leading-tight">
              Scan, install, and keep every receipt with you.
            </h2>
            <p className="mt-4 text-sm leading-6 text-black/64">
              Open this page on desktop and scan from your phone, or open it
              directly on mobile to choose your preferred download option.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {appFeatures.map(([label, Icon]) => (
              <div key={label as string} className="rounded-lg border border-white/8 bg-white/[0.04] p-4">
                <Icon aria-hidden="true" className="size-5 text-orange-300" />
                <p className="mt-4 text-sm font-semibold text-white">{label as string}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="apk-safety" className="bg-[#050505] px-4 py-20 sm:px-6 lg:px-8">
        <SectionTitle
          title="Installing the Android APK"
          text="APK downloads are useful when an app store is unavailable. Follow these trust checks before installing."
        />
        <div className="mx-auto mt-10 grid max-w-6xl gap-4 md:grid-cols-3">
          {safetyItems.map((item) => {
            const Icon = item.icon;

            return (
              <div key={item.title} className="rounded-xl border border-white/8 bg-[#121212] p-5">
                <Icon aria-hidden="true" className="size-6 text-orange-300" />
                <h2 className="mt-4 text-lg font-black text-white">{item.title}</h2>
                <p className="mt-3 text-sm leading-6 text-white/52">{item.text}</p>
              </div>
            );
          })}
        </div>
        <div className="mx-auto mt-8 max-w-3xl rounded-xl border border-orange-400/20 bg-orange-500/10 p-5">
          <div className="flex gap-3">
            <Fingerprint aria-hidden="true" className="mt-1 size-5 shrink-0 text-orange-300" />
            <p className="text-sm leading-6 text-white/66">
              TrustPay will never ask you to download an APK from a random chat
              group, share your OTP, or reveal your transaction PIN. When in
              doubt, contact support before installing.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-[linear-gradient(180deg,#06160f,#031009)] px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center rounded-xl border border-white/8 bg-white/[0.05] p-8 text-center">
          <BellRing aria-hidden="true" className="size-10 text-orange-300" />
          <h2 className="mt-5 max-w-2xl text-3xl font-black leading-tight text-white md:text-4xl">
            Want the official download link when the app is published?
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/52">
            Join the launch list and we will send the App Store, Google Play, or
            verified APK link through official TRUSTPAY support channels.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button asChild className="rounded-full bg-orange-500 text-white hover:bg-orange-400">
              <Link href="/register">Create account</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full border-white/12 bg-white/[0.04] text-white hover:bg-white hover:text-black">
              <Link href="/support">Contact support</Link>
            </Button>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
