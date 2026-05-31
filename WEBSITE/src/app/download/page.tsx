import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  FileDown,
  Fingerprint,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
  Store,
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
      <section className="relative overflow-hidden px-4 pb-14 pt-28 sm:px-6 lg:px-8">
        <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_52%_18%,rgba(255,107,10,0.2),transparent_32%),linear-gradient(180deg,#050605_0%,#080908_58%,#050505_100%)]" />
        <div className="mx-auto max-w-4xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/64">
            <span className="rounded-full bg-orange-500 px-2 py-0.5 font-semibold text-white">
              Mobile app
            </span>
            App stores or APK
          </p>
          <h1 className="mx-auto mt-6 max-w-3xl text-5xl font-black leading-[0.96] tracking-[-0.02em] text-white md:text-7xl">
            Download TrustPay.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-6 text-white/56 md:text-base">
            Install the app to exchange NGN and GHS, pay VTU services, and keep
            receipts close.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild className="rounded-full bg-orange-500 text-white hover:bg-orange-400">
              <Link href="#download-options">Choose download</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full border-white/12 bg-white/[0.04] text-white hover:bg-white hover:text-black">
              <Link href="#apk-safety">APK safety</Link>
            </Button>
          </div>
        </div>
      </section>

      <section id="download-options" className="bg-[#050505] px-4 py-16 sm:px-6 lg:px-8">
        <SectionTitle
          title="Choose download"
          text="Use the store that fits your device, or choose APK when store access is not available."
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

      <section id="apk-safety" className="bg-[#050505] px-4 pb-20 pt-8 sm:px-6 lg:px-8">
        <SectionTitle
          title="APK safety"
          text="Use APK only when app stores are unavailable. Follow these checks before installing."
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
    </MarketingShell>
  );
}
