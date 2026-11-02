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

export type BlogArticle = {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  image: { src: string; alt: string; credit: string; href: string };
  author: string;
  date: string;
  readTime: string;
  tags: string[];
};

export const navItems = [
  { label: "Download", href: "/download" },
  { label: "Blog", href: "/blog" },
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

export const pricingPlans = [
  {
    title: "Basic",
    description: "For simple wallet use and everyday payments.",
    price: "Free",
    points: [
      "Create NGN and GHS wallets",
      "Buy airtime and data",
      "Keep payment receipts",
    ],
  },
  {
    title: "Pro",
    description: "For frequent exchange and bill payments.",
    price: "Pay as you go",
    points: [
      "Clear exchange quotes",
      "Withdrawal status tracking",
      "Priority transaction support",
    ],
  },
  {
    title: "Business",
    description: "For teams that need stronger money operations.",
    price: "Custom",
    points: [
      "Higher-volume support",
      "Operational reports",
      "Business onboarding help",
    ],
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
    description: "For NGN and GHS.",
    icon: UsersRound,
  },
  {
    title: "Clear Money Movement",
    description: "Rates, fees, status.",
    icon: TrendingUp,
  },
  {
    title: "Operational Discipline",
    description: "Checks and records.",
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

export const blogArticles: BlogArticle[] = [
  {
    slug: "cbn-fintech-regulation-2026",
    title: "CBN's 2026 Fintech Strategy: What It Means for Naira-GHS Exchange",
    excerpt: "Nigeria's Central Bank released a landmark fintech strategy report in February 2026, signalling a shift toward innovation-friendly regulation that could transform cross-border payments between Nigeria and Ghana.",
    content: `The Central Bank of Nigeria (CBN) published its comprehensive Fintech Strategy Report in February 2026, marking a pivotal moment for digital financial services in Africa's largest economy.

The report outlines a clear roadmap for streamlining fintech approvals, deploying Supervisory Technology (SupTech) for real-time compliance monitoring, and creating sandbox frameworks that allow faster market entry for innovative payment solutions.

For the Nigeria-Ghana corridor, this regulatory evolution is particularly significant. The CBN's embrace of structured fintech oversight creates a more predictable environment for cross-border payment platforms like TrustPay, which facilitate NGN to GHS exchange for thousands of users.

"A predictable regulatory framework is the foundation for building trust in digital financial services," says the report. "We are committed to supporting innovation while maintaining the highest standards of financial integrity."

Key takeaways from the strategy include:\n\n- **Streamlined licensing:** Reduced approval timelines for payment service providers\n- **SupTech deployment:** AI-powered monitoring for compliance and fraud detection\n- **Sandbox expansion:** More flexible testing environments for new financial products\n- **Cross-border focus:** Specific provisions for regional payment corridors\n
The Bank of Ghana (BoG) has similarly signaled openness to fintech-led payment innovations, creating a regulatory environment where NGN-GHS exchange platforms can operate with greater confidence. As both regulators move toward more structured fintech frameworks, the corridor stands to benefit from increased investment, better infrastructure, and clearer consumer protections.

For TrustPay users, this means more reliable service, stronger security guarantees, and a platform that's aligned with the evolving regulatory landscape across both countries.`,
    image: {
      src: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&q=80&w=2000",
      alt: "Nigerian Naira and Ghanaian Cedi banknotes",
      credit: "Photo by Stephen on Unsplash",
      href: "https://unsplash.com/photos/pile-of-assorted-banknotes-t2S2tAk1SFw",
    },
    author: "TrustPay Editorial",
    date: "March 10, 2026",
    readTime: "4 min read",
    tags: ["Regulation", "CBN", "NGN"],
  },
  {
    slug: "west-africa-digital-payments-2026",
    title: "West Africa's Digital Payments Surge: Ghana and Nigeria Lead the Way",
    excerpt: "A surge in digital financial infrastructure across West Africa is reshaping how Ghanaians and Nigerians move money, with mobile money and fintech platforms driving unprecedented adoption.",
    content: `The first quarter of 2026 has seen an acceleration in digital payment adoption across West Africa, with Ghana and Nigeria emerging as the region's clear leaders in fintech innovation and usage.

According to recent industry data, mobile money transactions in both countries grew by over 40% year-on-year, driven by increasing smartphone penetration, improved agent networks, and a growing preference for digital over cash transactions.

In Ghana, the Bank of Ghana's continued support for mobile money interoperability has been a key driver. The country's universal QR code system now connects all major mobile money operators and banks, allowing seamless transfers across previously siloed networks.

Nigeria's fintech ecosystem continues to expand, with the naira's digital transformation gathering pace. The eNaira, Nigeria's central bank digital currency (CBDC), has seen increased adoption, particularly for cross-border transactions.

"The Nigeria-Ghana corridor is one of the most active payment corridors in Africa," notes a recent industry report. "With millions of people moving money between both countries for trade, education, and family support, the demand for efficient, low-cost exchange services has never been higher."

TrustPay sits at the intersection of these trends. By providing multi-currency wallets that hold both NGN and GHS balances, the platform eliminates the friction of traditional bank transfers and offers real-time exchange rates that reflect market conditions.

The surge in digital payments benefits everyone in the corridor:\n\n- **Lower costs:** Digital platforms reduce the fees associated with traditional money transfer operators\n- **Faster settlement:** Transactions that once took days now complete in minutes\n- **Better transparency:** Users can see rates, fees, and status in real time\n- **Greater access:** Mobile-first platforms reach users who were previously excluded from formal financial services\n\nAs West Africa's digital financial infrastructure continues to mature, platforms that prioritize clarity, speed, and trust will be best positioned to serve the region's growing demand for cross-border payment solutions.`,
    image: {
      src: "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?auto=format&fit=crop&q=80&w=2000",
      alt: "Mobile phone displaying digital payment",
      credit: "Photo by Christiann on Unsplash",
      href: "https://unsplash.com/photos/person-holding-smartphone-fIq0tET6llw",
    },
    author: "TrustPay Editorial",
    date: "February 25, 2026",
    readTime: "5 min read",
    tags: ["Digital Payments", "West Africa", "GHS"],
  },
  {
    slug: "bank-recapitalization-fintech-partnerships",
    title: "Bank Recapitalization Creates New Opportunities for Fintech Partnerships",
    excerpt: "As Nigerian and Ghanaian banks race to meet new capital requirements, many are turning to fintech partnerships to accelerate digital transformation and maintain market share.",
    content: `The CBN's March 2026 recapitalization deadline has triggered a wave of consolidation and strategic partnerships across Nigeria's banking sector, with similar pressures emerging in Ghana's financial industry.

The new capital requirements — designed to strengthen the banking system and support larger lending capacity — have forced traditional banks to evaluate their digital capabilities more seriously than ever before.

Rather than building digital infrastructure from scratch, many banks are pursuing partnerships with established fintechs that already have proven platforms, user bases, and regulatory compliance in place.

"Banks are realizing that partnering with fintechs is faster and more cost-effective than building competing platforms internally," explains a banking industry analyst. "This creates a win-win: banks get digital capabilities, and fintechs get access to the banks' customer base and regulatory infrastructure."

For the Nigeria-Ghana corridor, these partnerships could accelerate the development of seamless cross-border payment solutions. As banks and fintechs collaborate, users can expect:\n\n- **Integrated banking and wallet experiences:** Move money between bank accounts and digital wallets without leaving either platform\n- **Better exchange rates:** Higher volumes and stronger banking partnerships can reduce the cost of currency conversion\n- **Enhanced security:** Bank-grade security measures applied to fintech platforms\n- **Faster compliance:** Shared KYC and AML infrastructure reduces onboarding friction\n\nTrustPay's multi-currency wallet is well-positioned to benefit from this trend, as the platform's focus on clear records, transparent fees, and auditable transactions aligns with the compliance requirements that banks and regulators prioritize.

As the financial services landscape in both countries continues to evolve, the line between traditional banking and fintech will continue to blur — creating better outcomes for users who need to move money across the Nigeria-Ghana corridor.`,
    image: {
      src: "https://images.unsplash.com/photo-1560472354-b33ff0c44a43?auto=format&fit=crop&q=80&w=2000",
      alt: "Bank building with modern architecture",
      credit: "Photo by Clint Adair on Unsplash",
      href: "https://unsplash.com/photos/brown-concrete-building-under-blue-sky-during-daytime-BW0vK-FA3eg",
    },
    author: "TrustPay Editorial",
    date: "February 12, 2026",
    readTime: "4 min read",
    tags: ["Banking", "Partnerships", "NGN"],
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
      { label: "Blog", href: "/blog" },
      { label: "Contact Us", href: "/support" },
    ],
  },
  {
    title: "Get started",
    links: [
      { label: "Get the app", href: "/download" },
      { label: "Staff access", href: "/staff" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "/legal#privacy" },
      { label: "Request account deletion", href: "/account-deletion" },
      { label: "Terms of Use", href: "/legal#terms" },
    ],
  },
];
