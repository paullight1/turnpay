import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Mail, ShieldCheck } from "lucide-react";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Request account deletion | TrustPay",
  description: "How to request deletion of your TrustPay account and associated data.",
};

const emailHref = "mailto:support@trustpayhq.com?subject=TrustPay%20account%20deletion%20request";

export default function AccountDeletionPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-3xl px-4 pb-20 pt-32 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">TrustPay account support</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Request account deletion</h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
          You can ask us to delete your TrustPay account and associated personal data. You do not need to sign in to make a request.
        </p>

        <div className="mt-10 rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <Mail aria-hidden="true" className="mt-1 size-6 shrink-0 text-primary" />
            <div>
              <h2 className="text-xl font-semibold">Send your request</h2>
              <p className="mt-3 leading-7 text-muted-foreground">
                Email <a className="font-medium text-foreground underline underline-offset-4" href={emailHref}>support@trustpayhq.com</a> from the email address associated with your TrustPay account. Use the subject “TrustPay account deletion request”. If you no longer have access to that address, contact support and explain how we can reach you.
              </p>
              <Button asChild className="mt-5"><a href={emailHref}>Email a deletion request <ArrowRight aria-hidden="true" /></a></Button>
            </div>
          </div>
        </div>

        <div className="mt-8 space-y-7 text-base leading-7 text-muted-foreground">
          <div>
            <h2 className="text-xl font-semibold text-foreground">What happens next</h2>
            <p className="mt-3">Submitting a request does not immediately delete your account. Support must verify that the request is yours and review any account balance, pending transactions or other obligations before closure. We will explain any steps needed to complete your request.</p>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">Your data</h2>
            <p className="mt-3">Your request covers your account and associated personal data. Some information, such as transaction, identity verification or security records, may need to be kept for legal, fraud-prevention or dispute purposes. The records kept and applicable periods must be determined when your request is reviewed.</p>
            <p className="mt-3">Read our <Link href="/legal" className="font-medium text-foreground underline underline-offset-4">privacy information</Link> for more about the data TrustPay handles.</p>
          </div>
          <div className="flex gap-3 rounded-xl border border-border bg-muted/50 p-5 text-foreground">
            <ShieldCheck aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary" />
            <p>For your security, never include your password, transaction PIN, one-time code, BVN or NIN in your email.</p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
