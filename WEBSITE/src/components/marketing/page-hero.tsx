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
    <section className="relative isolate overflow-hidden border-b border-white/10 bg-[#050605] px-4 pb-16 pt-28 text-white sm:px-6 lg:px-8">
      <div className="absolute -left-28 -top-64 -z-10 h-[28rem] w-[calc(100%+14rem)] rounded-[0_0_100%_100%] bg-[radial-gradient(circle_at_45%_55%,#ffd36b_0%,#ff7a18_34%,#dc2f02_58%,rgba(5,6,5,0)_74%)] opacity-80 blur-[2px]" />
      <div className="absolute inset-0 -z-20 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_45%)]" />
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 text-center">
        <Badge variant="secondary" className="w-fit border-white/10 bg-white/[0.06] text-white">
          {eyebrow}
        </Badge>
        <div className="flex max-w-5xl flex-col items-center gap-4">
          <h1 className="text-4xl font-semibold leading-tight text-balance md:text-6xl lg:text-7xl">
            {title}
          </h1>
          <p className="max-w-3xl text-base leading-7 text-white/68 md:text-xl">
            {description}
          </p>
        </div>
        {children ? <div className="flex w-full max-w-md flex-col justify-center gap-3 sm:w-auto sm:max-w-none sm:flex-row">{children}</div> : null}
      </div>
    </section>
  );
}
