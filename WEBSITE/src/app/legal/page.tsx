import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BadgeCheck,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  Headphones,
  IdCard,
  LockKeyhole,
  MessageSquareText,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { PageHero } from "@/components/marketing/page-hero";
import { SectionHeading } from "@/components/marketing/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Privacy & Terms | TrustPay",
  description:
    "TrustPay's privacy and terms page explains the information we collect, how we use it, and the rules that apply to account and payment activity.",
};

type LegalTopic = {
  title: string;
  description: string;
  icon: LucideIcon;
  points: string[];
};

const privacyTopics: LegalTopic[] = [
  {
    title: "Information we collect",
    description:
      "We collect only the data needed to create your account, process transactions, and keep the platform safe.",
    icon: IdCard,
    points: [
      "Profile details such as your name, email address, phone number, and other setup information.",
      "Transaction records, wallet history, receipts, references, and support conversations tied to your account.",
      "Device and session signals such as browser type, IP address, timestamps, and security events.",
    ],
  },
  {
    title: "How we use your information",
    description:
      "Your data helps us deliver the service, protect funds, and respond to support or compliance requests.",
    icon: BadgeCheck,
    points: [
      "Create and secure your account, wallets, login session, OTP flow, and transaction PIN workflow.",
      "Process transfers, exchanges, bill payments, reversals, receipts, and dispute investigations.",
      "Detect fraud, reduce duplicate actions, and improve the reliability of the app and website.",
    ],
  },
  {
    title: "Who we share it with",
    description:
      "We share information only when it is needed to complete the service or meet legal and operational duties.",
    icon: UsersRound,
    points: [
      "Payment, verification, banking, and messaging providers that help us run the product.",
      "Regulators, auditors, law enforcement, or courts when disclosure is required by law.",
      "A successor company if TrustPay is sold or reorganized, with safeguards around the transfer.",
    ],
  },
  {
    title: "Retention and records",
    description:
      "Transaction and audit records are kept for as long as needed to support your account and legal obligations.",
    icon: Clock3,
    points: [
      "We keep records while your account is active and for additional periods required for disputes or law.",
      "We retain receipts, references, and settlement logs to help confirm what happened on a transaction.",
      "When data is no longer required, we remove or anonymize it according to our retention rules.",
    ],
  },
  {
    title: "Security controls",
    description:
      "We use technical and procedural controls to reduce the risk of account takeover, fraud, and data misuse.",
    icon: ShieldCheck,
    points: [
      "Transport security, session controls, and restricted access for sensitive account operations.",
      "Logging and monitoring for suspicious behavior, duplicate attempts, and high-risk actions.",
      "We will never ask you to share your password or transaction PIN in chat, email, or phone support.",
    ],
  },
  {
    title: "Your choices and rights",
    description:
      "You can review, update, or request deletion of information where the law allows it.",
    icon: MessageSquareText,
    points: [
      "Update your profile details, marketing preferences, and notification settings inside the product.",
      "Request access, correction, or deletion of your data by contacting support where applicable.",
      "You may close your account, but some records can stay on file for legal, tax, or audit reasons.",
    ],
  },
];

const termsTopics: LegalTopic[] = [
  {
    title: "Account responsibility",
    description:
      "You are responsible for the activity on your account and for keeping your credentials private.",
    icon: LockKeyhole,
    points: [
      "Use accurate, complete information and keep it up to date if your phone number or email changes.",
      "Protect your password, OTPs, and transaction PIN, and sign out from devices you no longer use.",
      "Do not allow someone else to use your account to move money or create payment requests for you.",
    ],
  },
  {
    title: "Payments and transfers",
    description:
      "Every transfer, swap, or bill payment must be reviewed before you confirm it.",
    icon: CircleDollarSign,
    points: [
      "Check the amount, currency, recipient, fee, and reference before every confirmation.",
      "Completed transactions may only be reversed when the rules, provider status, or law allow it.",
      "Retries and repeat taps should not create duplicate charges when the request is handled correctly.",
    ],
  },
  {
    title: "Fees and limits",
    description:
      "Fees, limits, and service availability can change based on product settings, risk, and provider rules.",
    icon: FileCheck2,
    points: [
      "We show the relevant amount and any fee before you approve a money movement.",
      "Daily, per-transaction, and product limits may apply to protect users and reduce abuse.",
      "Some services can be paused or restricted while we verify risk, provider status, or compliance checks.",
    ],
  },
  {
    title: "Acceptable use",
    description:
      "TrustPay must not be used for illegal, abusive, or deceptive activity.",
    icon: ShieldAlert,
    points: [
      "Do not use the service for fraud, money laundering, sanctions evasion, or unauthorized access.",
      "Do not scrape, overload, or interfere with the site, app, API, or provider integrations.",
      "Do not attempt to manipulate balances, references, settlement results, or identity checks.",
    ],
  },
  {
    title: "Suspension and termination",
    description:
      "We may suspend or close access if we detect risk, policy violations, or legal requirements.",
    icon: Headphones,
    points: [
      "Accounts can be paused while we investigate security issues, failed verification, or disputes.",
      "We may stop access to a feature, wallet, or the full account if provider or compliance rules require it.",
      "When a suspension happens, we will try to explain the reason and the next step where we can.",
    ],
  },
  {
    title: "Changes to these terms",
    description:
      "We may update this page as the service grows or rules change.",
    icon: BadgeCheck,
    points: [
      "We will post the current version here and update the last reviewed date when it changes.",
      "Your continued use of TrustPay after a notice means you accept the updated terms.",
      "If you have a concern about a change, contact support before you continue using the service.",
    ],
  },
];

function TopicCard({ topic }: { topic: LegalTopic }) {
  const Icon = topic.icon;

  return (
    <Card className="rounded-xl border-white/10 bg-white/[0.04] text-white shadow-none">
      <CardHeader className="border-b border-white/10 pb-4">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-red-600/10 text-red-400">
            <Icon aria-hidden="true" className="size-5" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-lg text-white">{topic.title}</CardTitle>
            <CardDescription className="text-white/62">
              {topic.description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <ul className="space-y-2">
          {topic.points.map((point) => (
            <li key={point} className="flex gap-3 text-sm leading-6 text-white/76">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-red-400" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function LegalPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Legal"
        title="Privacy & Terms"
        description="This page explains how TrustPay handles your information and the rules that apply to your account, wallet, and payment activity."
      >
        <Button asChild>
          <Link href="/legal#privacy">
            Privacy
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/legal#terms">Terms of Use</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/support">Contact Support</Link>
        </Button>
      </PageHero>

      <section className="px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="rounded-xl border-white/10 bg-white/[0.04] text-white shadow-none">
            <CardHeader>
              <Badge
                variant="secondary"
                className="w-fit border-white/10 bg-white/[0.06] text-red-300"
              >
                Read this first
              </Badge>
              <CardTitle className="text-2xl text-white">
                Clear information, clear rules.
              </CardTitle>
              <CardDescription className="text-white/62">
                We keep this page practical: what data is collected, why we use
                it, when it may be shared, and what rules apply when you use the
                app or website.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="rounded-xl border-white/10 bg-[#0c0f0d] text-white shadow-none">
            <CardHeader>
              <CardTitle className="text-base text-white">Last reviewed</CardTitle>
              <CardDescription className="text-white/62">
                June 2026
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 text-sm leading-6 text-white/68">
              Please review this page with your legal team before publishing
              publicly. This draft is written to be easy for users to read and
              for support teams to point to during account or payment questions.
            </CardContent>
          </Card>
        </div>
      </section>

      <section id="privacy" className="scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            eyebrow="Privacy"
            title="What information TrustPay collects and how it is used."
            description="We collect the minimum data needed to run your wallet, verify activity, prevent fraud, and help with support or compliance requests."
          />
          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {privacyTopics.map((topic) => (
              <TopicCard key={topic.title} topic={topic} />
            ))}
          </div>
        </div>
      </section>

      <section
        id="terms"
        className="scroll-mt-24 border-t border-white/10 bg-[#080908] px-4 py-20 text-white sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            eyebrow="Terms"
            title="Rules for using the TrustPay app and website."
            description="These terms cover account safety, payments, limits, acceptable use, and how we handle changes to the service."
            align="center"
            className="mx-auto"
          />
          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {termsTopics.map((topic) => (
              <TopicCard key={topic.title} topic={topic} />
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-6 text-white md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-xl font-semibold">
              Need help with a policy or transaction?
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/66">
              Contact support if a transaction looks wrong, if you want help
              understanding a fee, or if you need clarification on how your
              information is used.
            </p>
          </div>
          <Button
            asChild
            className="rounded-full bg-white text-black hover:bg-red-600 hover:text-white"
          >
            <Link href="/support">
              Open Support
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>
    </MarketingShell>
  );
}
