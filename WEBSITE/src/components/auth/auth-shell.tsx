import Link from "next/link";

import { TrustPayLogo } from "@/components/brand/trustpay-logo";
import { Card } from "@/components/ui/card";
import { TawkHelpButton } from "./tawk-help-button";

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  maxWidth?: string;
  showHero?: boolean;
  mobileCardless?: boolean;
};

export function AuthShell({
  title,
  subtitle,
  children,
  maxWidth = "max-w-md",
  showHero = true,
  mobileCardless = false,
}: AuthShellProps) {
  const hasHero = showHero && Boolean(title || subtitle);
  const cardClassName = mobileCardless
    ? `w-full ${maxWidth} justify-self-center border-0 bg-transparent px-0 py-0 text-white shadow-none ring-0 overflow-visible sm:overflow-hidden sm:rounded-xl sm:border-white/10 sm:bg-[#111111] sm:py-4 sm:shadow-2xl sm:shadow-black/45 sm:ring-1 sm:ring-foreground/10`
    : `w-full ${maxWidth} justify-self-center border-white/10 bg-[#111111] text-white shadow-2xl shadow-black/45 animate-trustpay-fade-up`;

  return (
    <main className="dark relative isolate flex min-h-screen flex-col overflow-hidden bg-[#050505] text-white">
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_50%_0%,rgba(220,38,38,0.22),transparent_32%)]" />
      <div className="absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-red-500/50 to-transparent" />

      <header className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <Link href="/" aria-label="TrustPay home">
          <TrustPayLogo imageClassName="size-11" textClassName="text-xl font-black" />
        </Link>
        <TawkHelpButton />
      </header>

      <div
        className={`relative z-10 mx-auto grid w-full flex-1 gap-8 px-4 py-6 sm:px-6 lg:px-8 ${
          hasHero
            ? "max-w-6xl items-center lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]"
            : "max-w-3xl items-start lg:justify-items-center"
        }`}
      >
        {hasHero ? (
          <section className="max-w-xl text-balance">
            <h1 className="text-3xl font-black leading-tight text-white sm:text-4xl lg:text-5xl">
              {title}
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-white/58 sm:text-base sm:leading-7">
              {subtitle}
            </p>
          </section>
        ) : null}

        <Card
          className={cardClassName}
        >
          {children}
        </Card>
      </div>

      <footer className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-6 pt-2 text-center text-xs leading-5 text-white/38 sm:px-6 lg:px-8">
        <p>Copyright {new Date().getFullYear()} TrustPay. Keep your OTP, password, and transaction PIN private.</p>
      </footer>
    </main>
  );
}
