import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BadgeCheck,
  Building2,
  Cable,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  Headphones,
  IdCard,
  LockKeyhole,
  MessageSquareText,
  Radar,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TrendingUp,
  UsersRound,
  WalletCards,
  Zap,
} from "lucide-react";

export type MarketingItem = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export const navItems = [
  { label: "Download", href: "/download" },
  { label: "About", href: "/about" },
  { label: "Contact Us", href: "/support" },
];

export const marketingImages = {
  mobilePayment: {
    src: "https://images.unsplash.com/photo-1743696398209-6b693d480862?auto=format&fit=crop&q=80&w=1800",
    alt: "A mobile payment being made with a smartphone",
    credit: "Photo by Vagaro on Unsplash",
    href: "https://unsplash.com/photos/mobile-payment-is-being-made-with-a-smartphone-cUxf_E0824k",
  },
  exchangeApp: {
    src: "https://images.unsplash.com/photo-1761198879998-6bb91fd6797c?auto=format&fit=crop&q=80&w=1600",
    alt: "A hand holding a phone with a mobile service app",
    credit: "Photo by Airalo on Unsplash",
    href: "https://unsplash.com/photos/hand-holding-a-smartphone-displaying-currency-exchange-rates-DqE4GfQMVxk",
  },
  dataApp: {
    src: "https://images.unsplash.com/photo-1760532081949-d4b9b707b33f?auto=format&fit=crop&q=80&w=1600",
    alt: "A phone showing mobile data plans",
    credit: "Photo by Airalo on Unsplash",
    href: "https://unsplash.com/photos/person-holding-a-smartphone-with-currency-exchange-app-vSb7TaP2EWs",
  },
} as const;

export const heroStats = [
  { label: "Supported Currencies", value: "NGN + GHS" },
  { label: "Wallet Availability", value: "24/7" },
  { label: "Core Services", value: "2" },
];

export const liveRails = [
  "Accra to Lagos exchange settled",
  "MTN data bundle delivered",
  "GHS to NGN quote created",
  "Electricity token delivered",
  "Airtime top-up completed",
];

export const productFeatures: MarketingItem[] = [
  {
    title: "Multi-Currency Wallets",
    description:
      "Keep NGN and GHS balances in one account.",
    icon: WalletCards,
  },
  {
    title: "Currency Exchange",
    description:
      "Swap cedis and naira after you see the rate.",
    icon: ArrowLeftRight,
  },
  {
    title: "Airtime & Data",
    description:
      "Buy airtime and data from the same wallet.",
    icon: Smartphone,
  },
  {
    title: "Cable & Utilities",
    description:
      "Pay TV and power bills without changing apps.",
    icon: Cable,
  },
  {
    title: "Receipts & Timeline",
    description:
      "See status, amount, date, and reference in one list.",
    icon: ReceiptText,
  },
  {
    title: "Risk-Aware Controls",
    description:
      "Check risky actions before money moves.",
    icon: ShieldCheck,
  },
];

export const serviceRows = [
  {
    title: "Exchange",
    description: "Swap NGN and GHS with a clear quote.",
    icon: CircleDollarSign,
    metric: "Main Service",
  },
  {
    title: "VTU",
    description: "Airtime, data, TV, and power payments.",
    icon: Zap,
    metric: "Utility Service",
  },
];

export const corridorSteps = [
  {
    title: "Create Your Wallet",
    description: "Sign up and get NGN and GHS balances.",
    icon: IdCard,
  },
  {
    title: "Choose a Service",
    description: "Exchange money or pay a VTU bill.",
    icon: Sparkles,
  },
  {
    title: "Confirm With Clarity",
    description: "Check fee, amount, and destination first.",
    icon: FileCheck2,
  },
  {
    title: "Track the Outcome",
    description: "See if it is pending, done, failed, or reversed.",
    icon: Radar,
  },
];

export const securityControls: MarketingItem[] = [
  {
    title: "Short-Lived Sessions",
    description:
      "Sessions expire so old access cannot stay open.",
    icon: Clock3,
  },
  {
    title: "Protected Financial Actions",
    description:
      "Wallet actions use checks and limits.",
    icon: LockKeyhole,
  },
  {
    title: "Transaction Idempotency",
    description:
      "Retries should not create duplicate charges.",
    icon: BadgeCheck,
  },
  {
    title: "Audit-Ready Records",
    description:
      "Money and admin actions keep a clear trail.",
    icon: FileCheck2,
  },
];

export const testimonials = [
  {
    quote:
      "I can exchange, pay bills, and see wallet activity in one place.",
    name: "Nana K.",
    role: "Small Business Owner",
  },
  {
    quote:
      "The receipts help. I can see what happened without guessing.",
    name: "Chidinma A.",
    role: "Frequent Sender",
  },
  {
    quote:
      "It feels made for the payments we do every day.",
    name: "Kojo M.",
    role: "Operations Lead",
  },
];

export const supportChannels: MarketingItem[] = [
  {
    title: "Account Help",
    description: "Get help with login, ID checks, wallets, and profile changes.",
    icon: Headphones,
  },
  {
    title: "Transaction Checks",
    description: "Use a reference to check a pending or failed payment.",
    icon: ReceiptText,
  },
  {
    title: "Business Support",
    description: "Ask about setup, limits, reports, and team use.",
    icon: Building2,
  },
  {
    title: "Product Questions",
    description: "Learn about exchange, VTU, and payment providers.",
    icon: MessageSquareText,
  },
];

export const companyValues: MarketingItem[] = [
  {
    title: "Built for the Corridor",
    description:
      "TrustPay starts with Ghana and Nigeria money needs.",
    icon: UsersRound,
  },
  {
    title: "Clear Money Movement",
    description:
      "Users should see balance, rate, fee, and status.",
    icon: TrendingUp,
  },
  {
    title: "Operational Discipline",
    description:
      "Money flows need checks, records, and clear fixes.",
    icon: ShieldCheck,
  },
];

export const faqItems = [
  {
    question: "Which currencies does TrustPay support?",
    answer:
      "TrustPay supports NGN and GHS wallets, exchange, funding, withdrawals, and bill payments.",
  },
  {
    question: "Can I pay bills from the same wallet?",
    answer:
      "Yes. You can pay airtime, data, TV, and power bills from your wallet.",
  },
  {
    question: "How does TrustPay prevent duplicate payments?",
    answer:
      "Each payment gets a unique reference. That helps retries stay safe.",
  },
  {
    question: "Is this for personal or business use?",
    answer:
      "It starts with personal wallets. Business setup is for teams and larger use.",
  },
];

export const footerGroups = [
  {
    title: "Product",
    links: [
      { label: "Download", href: "/download" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact Us", href: "/support" },
      { label: "Dashboard", href: "/dashboard" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign In", href: "/login" },
      { label: "Create Account", href: "/register" },
      { label: "Reset Password", href: "/forgot-password" },
    ],
  },
];
