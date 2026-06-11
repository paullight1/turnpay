import type { Metadata } from "next";
import {
  ArrowRight,
  HelpCircle,
  MessageSquareText,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Contact Us | TrustPay",
  description:
    "Contact TrustPay support on WhatsApp for wallet, exchange, VTU, receipt, and account help.",
};

const whatsappUrl =
  "https://wa.me/233555507240?text=Hello%20TrustPay%2C%20I%20need%20help%20with%20my%20account.";

const helpTopics = [
  {
    icon: ReceiptText,
    title: "Transaction help",
    text: "Send your reference, amount, and service type.",
  },
  {
    icon: ShieldCheck,
    title: "Account safety",
    text: "Never share OTPs, passwords, or transaction PINs.",
  },
  {
    icon: HelpCircle,
    title: "App support",
    text: "Ask about wallet, exchange, VTU, and download issues.",
  },
];

export default function SupportPage() {
  return (
    <MarketingShell>
      <section className="relative isolate overflow-hidden bg-[#050505] px-4 pb-20 pt-28 text-white sm:px-6 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,rgba(255,107,10,0.20),transparent_34%)]" />
        <div className="mx-auto max-w-5xl text-center">
          <span className="mx-auto inline-flex items-center gap-2 rounded-full border border-red-500/25 bg-red-600/10 px-4 py-2 text-sm font-semibold text-red-300">
            <MessageSquareText aria-hidden="true" className="size-4" />
            Contact us
          </span>

          <h1 className="mx-auto mt-6 max-w-3xl text-5xl font-black leading-[0.96] tracking-[-0.02em] text-white md:text-7xl">
            Need help with TrustPay?
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-6 text-white/60 md:text-base">
            Message us on WhatsApp for wallet, exchange, VTU, receipt, or account
            support.
          </p>

          <Button asChild className="mt-8 h-12 rounded-full bg-red-600 px-7 text-white hover:bg-red-500">
            <a href={whatsappUrl} target="_blank" rel="noreferrer">
              Contact us on WhatsApp
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </section>

      <section className="bg-[#050505] px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
          {helpTopics.map((topic) => {
            const Icon = topic.icon;

            return (
              <div key={topic.title} className="rounded-xl border border-white/10 bg-[#111111] p-5">
                <span className="grid size-11 place-items-center rounded-full bg-red-600 text-white">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <h2 className="mt-5 text-lg font-black text-white">{topic.title}</h2>
                <p className="mt-2 text-sm leading-6 text-white/54">{topic.text}</p>
              </div>
            );
          })}
        </div>

        <div className="mx-auto mt-8 max-w-5xl rounded-xl border border-red-500/20 bg-red-600/10 p-5 text-center">
          <p className="text-sm leading-6 text-white/64">
            TrustPay support will not ask for your password, OTP, full card
            details, or transaction PIN.
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
