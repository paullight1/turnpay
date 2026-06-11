import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, Clock, Tag } from "lucide-react";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { blogArticles } from "@/lib/marketing";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return blogArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = blogArticles.find((a) => a.slug === slug);
  if (!article) return { title: "Not Found | TrustPay" };

  return {
    title: `${article.title} | TrustPay Blog`,
    description: article.excerpt,
  };
}

export default async function BlogArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = blogArticles.find((a) => a.slug === slug);
  if (!article) notFound();

  const relatedArticles = blogArticles
    .filter((a) => a.slug !== slug)
    .slice(0, 2);

  const paragraphs = article.content.split("\n\n");

  return (
    <MarketingShell>
      <article>
        {/* Hero */}
        <section className="relative isolate overflow-hidden bg-[#050605] px-4 pb-16 pt-28 text-white sm:px-6 lg:px-8">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_30%_20%,rgba(220,38,38,0.12),transparent_40%),linear-gradient(180deg,#050605_0%,#080908_58%,#050505_100%)]" />
          <div className="mx-auto max-w-3xl">
            <Link
              href="/blog"
              className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-white/60 transition-colors hover:text-white"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to Blog
            </Link>

            <div className="flex flex-wrap items-center gap-3 text-xs text-white/50">
              <span className="flex items-center gap-1">
                <CalendarDays aria-hidden="true" className="size-3.5" />
                {article.date}
              </span>
              <span className="flex items-center gap-1">
                <Clock aria-hidden="true" className="size-3.5" />
                {article.readTime}
              </span>
              <span className="text-white/30">·</span>
              <span>{article.author}</span>
            </div>

            <h1 className="mt-4 text-4xl font-black leading-[1.05] tracking-[-0.02em] text-white md:text-5xl lg:text-6xl">
              {article.title}
            </h1>

            <p className="mt-4 max-w-2xl text-base leading-7 text-white/60 md:text-lg">
              {article.excerpt}
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {article.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="border-white/10 bg-white/[0.06] text-red-200"
                >
                  <Tag aria-hidden="true" className="mr-1 size-3" />
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </section>

        {/* Featured image */}
        <div className="relative mx-auto -mt-10 h-64 w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 shadow-2xl sm:h-80 md:h-96">
          <Image
            src={article.image.src}
            alt={article.image.alt}
            fill
            sizes="(min-width: 1280px) 896px, (min-width: 768px) 80vw, 100vw"
            className="object-cover"
            priority
          />
        </div>

        {/* Article content */}
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="prose prose-sm prose-zinc mx-auto max-w-none dark:prose-invert sm:prose-base">
            {paragraphs.map((paragraph, index) => {
              if (paragraph.startsWith("- ")) {
                const items = paragraph
                  .split("\n")
                  .filter((line) => line.startsWith("- "));
                return (
                  <ul key={index} className="my-6 space-y-2">
                    {items.map((item, i) => (
                      <li key={i} className="text-muted-foreground">
                        {item.replace(/^- /, "")}
                      </li>
                    ))}
                  </ul>
                );
              }
              if (paragraph.startsWith("\\n")) {
                return null;
              }
              return (
                <p
                  key={index}
                  className="text-base leading-7 text-muted-foreground"
                >
                  {paragraph}
                </p>
              );
            })}
          </div>

          {/* Author & share */}
          <div className="mt-12 rounded-2xl border border-border bg-muted/50 p-6">
            <div className="flex items-center gap-4">
              <span className="flex size-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                TP
              </span>
              <div>
                <p className="font-semibold text-foreground">{article.author}</p>
                <p className="text-sm text-muted-foreground">
                  Insights on the Nigeria-Ghana financial corridor.
                </p>
              </div>
            </div>
          </div>

          {relatedArticles.length > 0 && (
            <>
              <Separator className="my-12" />
              <div>
                <h2 className="text-2xl font-bold text-foreground">
                  More from TrustPay
                </h2>
                <div className="mt-6 grid gap-6 md:grid-cols-2">
                  {relatedArticles.map((related) => (
                    <Link
                      key={related.slug}
                      href={`/blog/${related.slug}`}
                      className="group rounded-xl border border-border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-primary/5"
                    >
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CalendarDays aria-hidden="true" className="size-3.5" />
                        {related.date}
                      </div>
                      <h3 className="mt-2 font-semibold text-foreground transition-colors group-hover:text-primary">
                        {related.title}
                      </h3>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                        {related.excerpt}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* CTA section */}
        <section className="relative overflow-hidden bg-primary px-4 py-20 text-center sm:px-6 lg:px-8">
          <div className="absolute -right-32 -top-32 h-80 w-80 rounded-full bg-white/5 blur-[80px]" />
          <div className="absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-white/5 blur-[80px]" />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-3xl font-black leading-tight text-primary-foreground md:text-4xl">
              Start Exchanging NGN and GHS Today
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-primary-foreground/80">
              Join thousands of users who trust TrustPay for clear, fast, and
              secure currency exchange.
            </p>
            <Button
              asChild
              className="mt-8 rounded-full bg-white text-primary hover:bg-white/90"
            >
              <a
                href="https://wa.me/233555507240?text=Hello%20TrustPay%2C%20I%20want%20to%20get%20started."
                target="_blank"
                rel="noreferrer"
              >
                Get Started on WhatsApp
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </a>
            </Button>
          </div>
        </section>
      </article>
    </MarketingShell>
  );
}
