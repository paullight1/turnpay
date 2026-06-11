import type { Metadata } from "next";
import Image from "next/image";
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
      <section className="relative min-h-[620px] overflow-hidden px-4 py-28 sm:px-6 lg:px-8">
        <Image
          src="https://images.unsplash.com/photo-1556742044-3c52d6e88c62?auto=format&fit=crop&q=85&w=2200"
          alt=""
          fill
          priority
          unoptimized
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-slate-950/72" />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/78 to-red-950/35" />
        <div className="relative mx-auto flex min-h-[420px] max-w-6xl items-end">
          <div className="max-w-3xl">
            <p className="inline-flex items-center rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-red-100 backdrop-blur">
              Mobile app
            </p>
            <h1 className="mt-6 max-w-3xl text-5xl font-bold leading-[0.98] tracking-tight text-white md:text-7xl">
              Download TrustPay
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-white/72">
              Install the app for NGN-GHS exchange, VTU payments, and receipts.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild className="rounded-full bg-red-600 text-white hover:bg-red-500">
                <Link href="#download-options">Choose download</Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full border-white/30 bg-white/10 text-white hover:bg-white hover:text-black">
                <Link href="#apk-safety">APK safety</Link>
              </Button>
            </div>
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
                <span className="grid size-12 place-items-center rounded-full bg-red-600 text-white">
                  <Icon aria-hidden="true" className="size-6" />
                </span>
                <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-red-400">
                  {option.label}
                </p>
                <h2 className="mt-2 text-xl font-black text-white">{option.title}</h2>
                <p className="mt-3 text-sm leading-6 text-white/52">{option.text}</p>
                <Button asChild className="mt-6 rounded-full bg-red-600 text-white hover:bg-red-500">
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
                <Icon aria-hidden="true" className="size-6 text-red-400" />
                <h2 className="mt-4 text-lg font-black text-white">{item.title}</h2>
                <p className="mt-3 text-sm leading-6 text-white/52">{item.text}</p>
              </div>
            );
          })}
        </div>
        <div className="mx-auto mt-8 max-w-3xl rounded-xl border border-red-500/20 bg-red-600/10 p-5">
          <div className="flex gap-3">
            <Fingerprint aria-hidden="true" className="mt-1 size-5 shrink-0 text-red-400" />
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
