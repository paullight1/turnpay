import Link from "next/link";
import { ArrowRight, Menu, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { footerGroups, navItems } from "@/lib/marketing";

function BrandMark() {
  return (
    <span className="inline-flex min-w-0 items-center gap-2" translate="no">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <ShieldCheck aria-hidden="true" className="size-5" />
      </span>
      <span className="min-w-0 text-lg font-semibold leading-none">TrustPay</span>
    </span>
  );
}

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:rounded-lg focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Skip to Content
      </a>
      <header className="fixed inset-x-0 top-0 z-40 border-b border-border/70 bg-background/88 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            aria-label="TrustPay home"
            className="rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <BrandMark />
          </Link>

          <nav
            aria-label="Main navigation"
            className="hidden items-center gap-1 rounded-lg border border-border/70 bg-background/70 p-1 md:flex"
          >
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <Button variant="ghost" asChild>
              <Link href="/login">Sign In</Link>
            </Button>
            <Button asChild>
              <Link href="/register">
                Open Wallet
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <div className="md:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon-lg" aria-label="Open menu">
                  <Menu aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[min(90vw,24rem)]">
                <SheetHeader>
                  <SheetTitle>
                    <BrandMark />
                  </SheetTitle>
                  <SheetDescription>
                    Wallets, exchange, airtime, and bill payments for the Ghana-Nigeria corridor.
                  </SheetDescription>
                </SheetHeader>
                <nav aria-label="Mobile navigation" className="flex flex-col gap-1 px-4">
                  {navItems.map((item) => (
                    <SheetClose asChild key={item.href}>
                      <Link
                        href={item.href}
                        className="rounded-lg px-3 py-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {item.label}
                      </Link>
                    </SheetClose>
                  ))}
                </nav>
                <SheetFooter>
                  <SheetClose asChild>
                    <Button asChild>
                      <Link href="/register">Create Account</Link>
                    </Button>
                  </SheetClose>
                  <SheetClose asChild>
                    <Button variant="outline" asChild>
                      <Link href="/login">Sign In</Link>
                    </Button>
                  </SheetClose>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main id="main" className="scroll-mt-24">
        {children}
      </main>

      <footer className="border-t border-border/70 bg-muted/30">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.3fr_2fr] lg:px-8">
          <div className="flex flex-col gap-4">
            <BrandMark />
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              A focused wallet experience for NGN and GHS exchange, VTU payments, withdrawals,
              and financial activity tracking.
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-border bg-background px-3 py-1">JWT-ready auth</span>
              <span className="rounded-full border border-border bg-background px-3 py-1">Audit-aware flows</span>
              <span className="rounded-full border border-border bg-background px-3 py-1">NGN + GHS</span>
            </div>
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
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-ring/50"
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
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} TrustPay. All rights reserved.</p>
          <p>Built for clear money movement across Ghana and Nigeria.</p>
        </div>
      </footer>
    </div>
  );
}
