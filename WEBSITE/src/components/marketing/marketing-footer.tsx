import Link from "next/link";
import { Facebook, Instagram, Linkedin, Mail, Send, Twitter } from "lucide-react";

import { TrustPayLogo } from "@/components/brand/trustpay-logo";
import { Separator } from "@/components/ui/separator";
import { footerGroups } from "@/lib/marketing";

const socialIcons = [Facebook, Instagram, Send, Twitter, Linkedin];

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-muted">
      <div className="mx-auto grid w-full max-w-7xl gap-7 px-5 py-7 sm:px-8 lg:grid-cols-[1.1fr_1.9fr] lg:gap-10 lg:py-9">
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-[1fr_auto] lg:grid-cols-1">
          <div>
            <TrustPayLogo imageClassName="size-9 rounded-lg" textClassName="text-lg font-bold text-foreground" />
            <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
              Pay bills, buy airtime and data, and manage everyday payments with TrustPay. Made for Nigeria.
            </p>
          </div>

          <div className="text-xs leading-5 text-muted-foreground sm:row-span-2 lg:row-span-1">
            <h2 className="mb-1 font-semibold text-foreground">Contact us</h2>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <a href="mailto:support@trustpayhq.com" className="break-all hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-primary/50">support@trustpayhq.com</a>
              <a href="mailto:trustpaylink@gmail.com" className="break-all hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-primary/50">trustpaylink@gmail.com</a>
              <a href="tel:+233555507240" className="hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-primary/50">+233 55 550 7240</a>
              <a href="tel:+2349125110943" className="hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-primary/50">+234 912 511 0943</a>
            </div>
            <address className="mt-1 max-w-md not-italic">
              19 Falohun Street, Orile, Surulere, Lagos State, Nigeria
            </address>
          </div>

          <div className="flex items-center gap-2">
            {socialIcons.map((Icon, index) => (
              <Link
                key={index}
                href="/support"
                aria-label="TrustPay social channel"
                className="grid size-8 place-items-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <Icon aria-hidden="true" className="size-4" />
              </Link>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 sm:gap-x-4 sm:gap-y-3">
          {footerGroups.map((group) => (
            <div key={group.title} className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold text-foreground">{group.title}</h2>
              <div className="flex flex-col gap-1.5">
                {group.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="text-xs leading-5 text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-primary/50"
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
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-1.5 px-5 py-3 text-[11px] text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>Copyright {new Date().getFullYear()} TrustPay. All rights reserved.</p>
        <p className="flex items-center gap-1">
          Built for clear, safe payment operations
          <Mail aria-hidden="true" className="ml-1 size-3" />
        </p>
      </div>
    </footer>
  );
}
