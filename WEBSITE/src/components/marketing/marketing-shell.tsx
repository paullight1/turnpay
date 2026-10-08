import Link from "next/link";
import { ArrowRight, Facebook, Instagram, Linkedin, Mail, Menu, Send, Twitter } from "lucide-react";

import { TrustPayLogo } from "@/components/brand/trustpay-logo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { footerGroups, navItems } from "@/lib/marketing";

function BrandMark() {
  return <TrustPayLogo imageClassName="size-9 rounded-lg" textClassName="text-lg font-bold text-foreground" />;
}

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground focus:shadow-lg focus-visible:ring-3 focus-visible:ring-primary/50"
      >
        Skip to Content
      </a>
      <header className="fixed inset-x-0 top-0 z-40 border-b border-border bg-background/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            aria-label="TrustPay home"
            className="rounded-lg focus-visible:ring-3 focus-visible:ring-primary/50"
          >
            <BrandMark />
          </Link>

          <nav
            aria-label="Main navigation"
            className="hidden items-center gap-1 rounded-full border border-border bg-muted p-1 md:flex"
          >
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-primary/50"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <Button
              asChild
              className="rounded-full bg-primary px-4 text-primary-foreground hover:bg-primary/90"
            >
              <Link href="/download">
                Download app
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <details className="group relative">
              <summary
                aria-label="Open menu"
                className="grid min-h-11 size-11 cursor-pointer list-none place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent focus-visible:ring-3 focus-visible:ring-primary/50 [&::-webkit-details-marker]:hidden"
              >
                <Menu aria-hidden="true" className="size-5" />
              </summary>
              <nav
                aria-label="Mobile navigation"
                className="absolute right-0 top-13 z-50 grid w-52 gap-1 rounded-xl border border-border bg-card p-2 shadow-xl shadow-black/10"
              >
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-lg px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-primary/50"
                  >
                    {item.label}
                  </Link>
                ))}
                <Link
                  href="/download"
                  className="mt-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-primary/50"
                >
                  Download app
                </Link>
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main id="main" className="scroll-mt-24">
        {children}
      </main>

      <footer className="border-t border-border bg-muted">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.3fr_2fr] lg:px-8">
          <div className="flex flex-col gap-4">
            <TrustPayLogo imageClassName="size-10 rounded-lg" textClassName="text-xl font-bold text-foreground" />
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              Exchange NGN and GHS. Pay VTU services. Keep clear receipts.
              Built for the Nigeria–Ghana corridor.
            </p>
            <div className="flex flex-col gap-3 text-sm leading-6 text-muted-foreground">
              <h2 className="font-semibold text-foreground">Contact us</h2>
              <div className="flex flex-col gap-1">
                <a
                  href="mailto:support@trustpayhq.com"
                  className="w-fit break-all transition-colors hover:text-foreground focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-primary/50"
                >
                  support@trustpayhq.com
                </a>
                <a
                  href="mailto:trustpaylink@gmail.com"
                  className="w-fit break-all transition-colors hover:text-foreground focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-primary/50"
                >
                  trustpaylink@gmail.com
                </a>
                <a
                  href="tel:+2349125110943"
                  className="w-fit transition-colors hover:text-foreground focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-primary/50"
                >
                  +234 912 511 0943
                </a>
              </div>
              <address className="max-w-md not-italic">
                19 Falohun Street, Orile, Surulere, Lagos State, Nigeria
              </address>
            </div>
            <div className="flex flex-wrap gap-2 text-muted-foreground">
              {[Facebook, Instagram, Send, Twitter, Linkedin].map((Icon, index) => (
                <Link
                  key={index}
                  href="/support"
                  aria-label="TrustPay social channel"
                  className="grid size-8 place-items-center rounded-full border border-border bg-background transition-colors hover:border-primary/30 hover:text-primary"
                >
                  <Icon aria-hidden="true" className="size-4" />
                </Link>
              ))}
            </div>
            <Link
              href="/admin"
              className="w-fit text-sm font-medium text-primary transition-colors hover:text-primary/80 focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-primary/50"
            >
              Admin access
            </Link>
          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {footerGroups.map((group) => (
              <div key={group.title} className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold text-foreground">{group.title}</h2>
                <div className="flex flex-col gap-2">
                  {group.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-primary/50"
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
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-5 text-xs text-muted-foreground/60 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>
            Copyright {new Date().getFullYear()} TrustPay. All rights reserved.
          </p>
          <p className="flex items-center gap-1">
            Built for clear, safe banking operations
            <Mail aria-hidden="true" className="ml-1 size-3" />
          </p>
        </div>
      </footer>
    </div>
  );
}
