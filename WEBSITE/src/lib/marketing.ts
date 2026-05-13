import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BadgeCheck,
  Building2,
  Cable,
  CircleDollarSign,
  Clock3,
  CreditCard,
  FileCheck2,
  Headphones,
  IdCard,
  Landmark,
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
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
  { label: "Security", href: "/security" },
  { label: "Company", href: "/company" },
  { label: "Support", href: "/support" },
];

export const heroStats = [
  { label: "Supported Currencies", value: "NGN + GHS" },
  { label: "Wallet Availability", value: "24/7" },
  { label: "Payment Categories", value: "4+" },
];

export const liveRails = [
  "Accra to Lagos exchange settled",
  "MTN data bundle delivered",
  "DStv bill queued for receipt",
  "Wallet funding verified",
  "Airtime top-up completed",
];

export const productFeatures: MarketingItem[] = [
  {
    title: "Multi-Currency Wallets",
    description:
      "Hold dedicated NGN and GHS balances with clear available balance, transaction references, and receipts.",
    icon: WalletCards,
  },
  {
    title: "Currency Exchange",
    description:
      "Convert between Ghanaian cedis and Nigerian naira with visible rates before users confirm.",
    icon: ArrowLeftRight,
  },
  {
    title: "Airtime & Data",
    description:
      "Buy mobile airtime and data bundles from one wallet flow without switching providers.",
    icon: Smartphone,
  },
  {
    title: "Cable & Utilities",
    description:
      "Pay cable TV and electricity bills from the same balance used for everyday transfers.",
    icon: Cable,
  },
  {
    title: "Receipts & Timeline",
    description:
      "Give users a searchable activity trail with status, reference, amount, and currency context.",
    icon: ReceiptText,
  },
  {
    title: "Risk-Aware Controls",
    description:
      "Shape every critical action around validation, idempotency, audit trails, and protected routes.",
    icon: ShieldCheck,
  },
];

export const serviceRows = [
  {
    title: "Fund Wallet",
    description: "Card, bank, and provider-ready wallet funding flows.",
    icon: CreditCard,
    metric: "Fast Funding",
  },
  {
    title: "Exchange",
    description: "Two-way NGN and GHS exchange with quoted rates.",
    icon: CircleDollarSign,
    metric: "Clear Rates",
  },
  {
    title: "VTU",
    description: "Airtime, data, cable, and electricity payments.",
    icon: Zap,
    metric: "Instant Orders",
  },
  {
    title: "Withdraw",
    description: "Move funds back to verified bank destinations.",
    icon: Landmark,
    metric: "Verified Payouts",
  },
];

export const corridorSteps = [
  {
    title: "Create Your Wallet",
    description: "Register, verify your phone, and provision NGN and GHS balances.",
    icon: IdCard,
  },
  {
    title: "Choose a Service",
    description: "Fund, exchange, withdraw, or buy digital services from the same dashboard.",
    icon: Sparkles,
  },
  {
    title: "Confirm With Clarity",
    description: "Review fees, amount, destination, and reference before every transaction.",
    icon: FileCheck2,
  },
  {
    title: "Track the Outcome",
    description: "Follow pending, successful, failed, and reversed transactions in one timeline.",
    icon: Radar,
  },
];

export const securityControls: MarketingItem[] = [
  {
    title: "Short-Lived Sessions",
    description:
      "Access and refresh flows are designed for rotation, expiry, and device visibility.",
    icon: Clock3,
  },
  {
    title: "Protected Financial Actions",
    description:
      "Sensitive routes and wallet operations are designed to be guarded and rate limited.",
    icon: LockKeyhole,
  },
  {
    title: "Transaction Idempotency",
    description:
      "Repeated requests can return the original result instead of creating duplicate charges.",
    icon: BadgeCheck,
  },
  {
    title: "Audit-Ready Records",
    description:
      "Financial events and admin actions are structured for traceability and investigation.",
    icon: FileCheck2,
  },
];

export const pricingPlans = [
  {
    title: "Starter",
    description: "For personal wallets and early users testing the corridor.",
    price: "Free",
    points: ["NGN and GHS wallets", "Airtime and data top-ups", "Transaction history"],
  },
  {
    title: "Everyday",
    description: "For active users sending, exchanging, and paying bills often.",
    price: "Low Fee",
    points: ["Transparent exchange quote", "Bill payment receipts", "Priority support queue"],
  },
  {
    title: "Business",
    description: "For merchants, teams, and high-volume wallet operations.",
    price: "Custom",
    points: ["Higher review limits", "Admin reporting", "Dedicated onboarding"],
  },
];

export const testimonials = [
  {
    quote:
      "The product finally puts exchange, bill payments, and wallet activity in one clean workflow.",
    name: "Nana K.",
    role: "Small Business Owner",
  },
  {
    quote:
      "The receipt trail matters. I can see references, statuses, and what happened without guessing.",
    name: "Chidinma A.",
    role: "Frequent Sender",
  },
  {
    quote:
      "It feels built for everyday West African payments rather than a generic wallet clone.",
    name: "Kojo M.",
    role: "Operations Lead",
  },
];

export const supportChannels: MarketingItem[] = [
  {
    title: "Account Help",
    description: "Get help with login, verification, wallets, and profile changes.",
    icon: Headphones,
  },
  {
    title: "Transaction Checks",
    description: "Use references and receipts to trace pending or failed transactions.",
    icon: ReceiptText,
  },
  {
    title: "Business Support",
    description: "Talk through onboarding, limits, reporting, and operational workflows.",
    icon: Building2,
  },
  {
    title: "Product Questions",
    description: "Understand pricing, supported services, and upcoming payment providers.",
    icon: MessageSquareText,
  },
];

export const companyValues: MarketingItem[] = [
  {
    title: "Built for the Corridor",
    description:
      "TrustPay focuses on practical payment habits across Ghana and Nigeria first.",
    icon: UsersRound,
  },
  {
    title: "Clear Money Movement",
    description:
      "Users should always know the source balance, destination, rate, fee, and status.",
    icon: TrendingUp,
  },
  {
    title: "Operational Discipline",
    description:
      "Financial flows are designed around validation, auditability, and failure recovery.",
    icon: ShieldCheck,
  },
];

export const faqItems = [
  {
    question: "Which currencies does TrustPay support?",
    answer:
      "The current product focus is NGN and GHS wallets, exchange, wallet funding, withdrawals, and VTU-style payments.",
  },
  {
    question: "Can I pay bills from the same wallet?",
    answer:
      "Yes. The public product flow is built around airtime, data, cable TV, and electricity payments from wallet balances.",
  },
  {
    question: "How does TrustPay prevent duplicate payments?",
    answer:
      "Payment-style actions are designed to use unique request references so retries can be recognized safely.",
  },
  {
    question: "Is this for personal or business use?",
    answer:
      "The first experience supports personal wallets, with business onboarding and reporting positioned for higher-volume users.",
  },
];

export const footerGroups = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "Pricing", href: "/pricing" },
      { label: "Security", href: "/security" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/company" },
      { label: "Support", href: "/support" },
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
