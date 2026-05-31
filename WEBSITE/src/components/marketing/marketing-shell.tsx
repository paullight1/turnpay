import Link from "next/link";
import { ArrowRight, Facebook, Instagram, Linkedin, Menu, Send, Twitter } from "lucide-react";

import { TrustPayLogo } from "@/components/brand/trustpay-logo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { footerGroups, navItems } from "@/lib/marketing";

function BrandMark() {
  return <TrustPayLogo imageClassName="size-10" />;
}

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#030403] text-white">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:text-black focus:shadow-lg focus-visible:ring-3 focus-visible:ring-orange-300/50"
      >
        Skip to Content
      </a>
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/8 bg-[#030403]/86 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            aria-label="TrustPay home"
            className="rounded-lg focus-visible:ring-3 focus-visible:ring-orange-300/50"
          >
            <BrandMark />
          </Link>

          <nav
            aria-label="Main navigation"
            className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 md:flex"
          >
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="trustpay-nav-link rounded-full px-3 py-1.5 text-xs font-medium text-white/64 transition-colors hover:bg-white/8 hover:text-white focus-visible:ring-3 focus-visible:ring-orange-300/50"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <Button variant="ghost" asChild className="text-white/78 hover:bg-white/8 hover:text-white">
              <Link href="/login">Sign In</Link>
            </Button>
            <Button
              asChild
              className="rounded-full bg-white px-4 text-black hover:bg-orange-500 hover:text-white"
            >
              <Link href="/register">
                Get Started
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <details className="group relative">
              <summary
                aria-label="Open menu"
                className="grid min-h-11 size-11 cursor-pointer list-none place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white transition-colors hover:border-orange-400/60 hover:bg-orange-500/16 focus-visible:ring-3 focus-visible:ring-orange-300/50 [&::-webkit-details-marker]:hidden"
              >
                <Menu aria-hidden="true" className="size-5" />
              </summary>
              <nav
                aria-label="Mobile navigation"
                className="absolute right-0 top-13 z-50 grid w-52 gap-1 rounded-xl border border-white/10 bg-[#070807] p-2 shadow-2xl shadow-black/50"
              >
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-lg px-3 py-2 text-sm font-semibold text-white/72 transition-colors hover:bg-orange-500/14 hover:text-orange-200 focus-visible:ring-3 focus-visible:ring-orange-300/50"
                  >
                    {item.label}
                  </Link>
                ))}
                <Link
                  href="/login"
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-white/72 transition-colors hover:bg-orange-500/14 hover:text-orange-200 focus-visible:ring-3 focus-visible:ring-orange-300/50"
                >
                  Sign In
                </Link>
                <Link
                  href="/register"
                  className="mt-1 rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-400 focus-visible:ring-3 focus-visible:ring-orange-300/50"
                >
                  Get Started
                </Link>
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main id="main" className="trustpay-motion-root scroll-mt-24">
        {children}
      </main>

      <footer className="border-t border-white/8 bg-[#040504]">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.3fr_2fr] lg:px-8">
          <div className="flex flex-col gap-4">
            <BrandMark />
            <p className="max-w-md text-sm leading-6 text-white/54">
              Exchange NGN and GHS. Pay VTU services. Keep clear receipts.
            </p>
            <div className="flex flex-wrap gap-2 text-white/62">
              {[Facebook, Instagram, Send, Twitter, Linkedin].map((Icon, index) => (
                <Link
                  key={index}
                  href="/support"
                  aria-label="TrustPay social channel"
                  className="grid size-8 place-items-center rounded-full border border-white/10 bg-white/[0.04] transition-colors hover:border-orange-400/70 hover:text-orange-300"
                >
                  <Icon aria-hidden="true" className="size-4" />
                </Link>
              ))}
            </div>
            <Link
              href="/admin"
              className="w-fit text-sm font-medium text-orange-300 transition-colors hover:text-orange-200 focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-orange-300/50"
            >
              Admin access
            </Link>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {footerGroups.map((group) => (
              <div key={group.title} className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">{group.title}</h2>
                <div className="flex flex-col gap-2">
                  {group.links.map((link) => (
                    <Link
                    key={link.href}
                    href={link.href}
                    className="text-sm text-white/52 transition-colors hover:text-white focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-orange-300/50"
                  >
                    {link.label}
                  </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <Separator />
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-5 text-xs text-white/42 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>
            Copyright {new Date().getFullYear()} TrustPay. All rights reserved.
          </p>
          <p>Built for clear, safe banking operations.</p>
        </div>
      </footer>
    </div>
  );
}
