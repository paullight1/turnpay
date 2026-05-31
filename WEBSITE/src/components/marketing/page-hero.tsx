import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

type PageHeroProps = {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
};

export function PageHero({ eyebrow, title, description, children }: PageHeroProps) {
  return (
    <section className="relative isolate overflow-hidden border-b border-white/10 bg-[#050605] px-4 pb-16 pt-28 text-white trustpay-ledger-bg sm:px-6 lg:px-8">
      <div className="absolute inset-x-0 top-0 -z-10 h-52 bg-[linear-gradient(180deg,rgba(255,107,10,0.24),rgba(16,185,129,0.08),transparent)]" />
      <div className="absolute inset-0 -z-20 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_45%)]" />
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 text-center">
        <Badge variant="secondary" className="w-fit border-white/10 bg-white/[0.06] text-white animate-trustpay-fade-up">
          {eyebrow}
        </Badge>
        <div className="flex max-w-5xl flex-col items-center gap-4">
          <h1 className="text-4xl font-semibold leading-tight text-balance animate-trustpay-fade-up md:text-6xl lg:text-7xl" style={{ animationDelay: "80ms" }}>
            {title}
          </h1>
          <p className="max-w-3xl text-base leading-7 text-white/68 animate-trustpay-fade-up md:text-xl" style={{ animationDelay: "150ms" }}>
            {description}
          </p>
        </div>
        {children ? <div className="flex w-full max-w-md flex-col justify-center gap-3 animate-trustpay-fade-up sm:w-auto sm:max-w-none sm:flex-row" style={{ animationDelay: "220ms" }}>{children}</div> : null}
      </div>
    </section>
  );
}
