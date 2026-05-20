import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { footerGroups, navItems } from "@/lib/marketing";

function BrandMark() {
  return (
    <span className="inline-flex min-w-0 items-center gap-2" translate="no">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-orange-500 text-white shadow-sm shadow-orange-950/30">
        <ShieldCheck aria-hidden="true" className="size-5" />
      </span>
      <span className="min-w-0 text-lg font-semibold leading-none">TrustPay</span>
    </span>
  );
}

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#080a09] text-[#f7f3ec] [color-scheme:dark]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:text-black focus:shadow-lg focus-visible:ring-3 focus-visible:ring-orange-300/50"
      >
        Skip to Content
      </a>
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#080a09]/86 backdrop-blur-xl">
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
            className="hidden items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] p-1 md:flex"
          >
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-3 focus-visible:ring-orange-300/50"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <Button variant="ghost" asChild className="text-white hover:bg-white/10 hover:text-white">
              <Link href="/login">Sign In</Link>
            </Button>
            <Button asChild className="bg-orange-500 text-white hover:bg-orange-400">
              <Link href="/login">
                User Login
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <div className="md:hidden">
            <Button asChild className="min-h-11 bg-orange-500 px-4 text-white hover:bg-orange-400">
              <Link href="/login">Login</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main" className="scroll-mt-24">
        {children}
      </main>

      <footer className="border-t border-white/10 bg-[#0d100e]">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.3fr_2fr] lg:px-8">
          <div className="flex flex-col gap-4">
            <BrandMark />
            <p className="max-w-md text-sm leading-6 text-white/58">
              A safer admin workspace for wallet support, KYC checks, provider
              review, reconciliation, and audit trails.
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-white/58">
              <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1">Guarded admin routes</span>
              <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1">Audit trails</span>
              <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1">Masked bank data</span>
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
                      className="text-sm text-white/55 transition-colors hover:text-white focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-orange-300/50"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <Separator className="bg-white/10" />
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-5 text-xs text-white/48 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>Copyright {new Date().getFullYear()} TrustPay. All rights reserved.</p>
          <p>Built for clear, safe banking operations.</p>
        </div>
      </footer>
    </div>
  );
}
