import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-provider";
import { QueryProvider } from "@/lib/query-provider";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { SupportWidget } from "@/components/support-widget";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://trustpay.xyz",
  ),
  title: {
    default: "Naira to Cedi Exchange | TrustPay",
    template: "%s | TrustPay",
  },
  description:
    "Exchange Nigerian naira to Ghanaian cedis with TrustPay. Get a clear NGN to GHS quote, transparent fees, secure settlement, and a receipt.",
  keywords: [
    "naira to cedi",
    "NGN to GHS exchange",
    "exchange naira to Ghana cedis",
    "Nigeria Ghana money transfer",
    "GHS to NGN exchange",
    "TrustPay exchange",
  ],
  applicationName: "TrustPay",
  category: "finance",
  creator: "TrustPay",
  publisher: "TrustPay",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "TrustPay",
    locale: "en_NG",
    title: "Naira to Cedi Exchange | TrustPay",
    description:
      "Exchange Nigerian naira to Ghanaian cedis with a clear NGN to GHS quote, transparent fees, and secure settlement.",
    url: "/",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "TrustPay Naira to Cedi exchange",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Naira to Cedi Exchange | TrustPay",
    description:
      "Exchange Nigerian naira to Ghanaian cedis with a clear quote and secure settlement.",
    images: ["/twitter-image"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f3ec" },
    { media: "(prefers-color-scheme: dark)", color: "#080a09" },
  ],
};

// The page shell receives a fresh CSP nonce from proxy on every request.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              {children}
              <Toaster />
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
        <SupportWidget />
      </body>
    </html>
  );
}
