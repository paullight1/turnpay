import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, CalendarDays, Clock, Tag } from "lucide-react";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MotionSection, MotionCard } from "@/components/animations/motion-section";
import { blogArticles } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Blog | TrustPay",
  description:
    "Latest news and insights about NGN and GHS exchange, digital payments, and the Nigeria-Ghana financial corridor.",
};

export default function BlogPage() {
  return (
    <MarketingShell>
      <MotionSection>
      <section className="relative isolate overflow-hidden bg-[#050605] px-4 pb-20 pt-28 text-white sm:px-6 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_30%_20%,rgba(220,38,38,0.15),transparent_40%),radial-gradient(circle_at_70%_60%,rgba(220,38,38,0.08),transparent_35%),linear-gradient(180deg,#050605_0%,#080908_58%,#050505_100%)]" />
        <div className="mx-auto max-w-4xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/64">
            <span className="rounded-full bg-red-600 px-2 py-0.5 font-semibold text-white">
              New
            </span>
            TrustPay Blog
          </p>
          <h1 className="mx-auto mt-6 max-w-3xl text-5xl font-black leading-[0.96] tracking-[-0.02em] text-white md:text-7xl">
            NGN, GHS & the<br />
            <span className="text-red-400">Nigeria–Ghana Corridor</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-6 text-white/56 md:text-base">
            Insights on exchange rates, digital payments, regulation, and the
            evolving financial landscape connecting Accra and Lagos.
          </p>
        </div>
      </section>
      </MotionSection>

      <section className="bg-background px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {blogArticles.map((article, index) => (
              <MotionCard key={article.slug} index={index}>
              <Link
                href={`/blog/${article.slug}`}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5"
              >
                <div className="relative h-48 overflow-hidden sm:h-56">
                  <Image
                    src={article.image.src}
                    alt={article.image.alt}
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                  <div className="absolute bottom-3 left-3 flex flex-wrap gap-2">
                    {article.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="border-white/10 bg-black/50 text-xs text-white backdrop-blur-sm"
                      >
                        <Tag aria-hidden="true" className="mr-1 size-3" />
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-3 p-5">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CalendarDays aria-hidden="true" className="size-3.5" />
                      {article.date}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock aria-hidden="true" className="size-3.5" />
                      {article.readTime}
                    </span>
                  </div>
                  <h2 className="text-lg font-bold leading-snug text-foreground transition-colors group-hover:text-primary">
                    {article.title}
                  </h2>
                  <p className="flex-1 text-sm leading-6 text-muted-foreground">
                    {article.excerpt}
                  </p>
                  <div className="flex items-center gap-2 pt-2 text-sm font-medium text-primary">
                    Read more
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 transition-transform group-hover:translate-x-1"
                    />
                  </div>
                </div>
              </Link>
              </MotionCard>
            ))}
          </div>
        </div>
      </section>

      <MotionSection>
      <section className="relative overflow-hidden bg-primary px-4 py-20 text-center sm:px-6 lg:px-8">
        <div className="absolute -right-32 -top-32 h-80 w-80 rounded-full bg-white/5 blur-[80px]" />
        <div className="absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-white/5 blur-[80px]" />
        <div className="relative mx-auto max-w-2xl">
          <h2 className="text-3xl font-black leading-tight text-primary-foreground md:text-4xl">
            Stay Updated on the NGN–GHS Corridor
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-primary-foreground/80">
            Follow TrustPay for the latest insights on exchange rates, digital
            payments, and financial inclusion across Nigeria and Ghana.
          </p>
          <Button
            asChild
            className="mt-8 rounded-full bg-white text-primary hover:bg-white/90"
          >
            <a
              href="https://wa.me/233555507240?text=Hello%20TrustPay%2C%20I%20want%20to%20learn%20more%20about%20your%20services."
              target="_blank"
              rel="noreferrer"
            >
              Get Started on WhatsApp
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </section>
      </MotionSection>
    </MarketingShell>
  );
}
