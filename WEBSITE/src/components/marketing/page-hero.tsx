import type { ReactNode } from "react";
import Image from "next/image";

import { Badge } from "@/components/ui/badge";

type PageHeroProps = {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
};

export function PageHero({ eyebrow, title, description, children }: PageHeroProps) {
  return (
    <section className="relative isolate overflow-hidden border-b border-border/70 bg-muted/30 px-4 pb-16 pt-28 sm:px-6 lg:px-8">
      <Image
        src="/trustpay-hero.svg"
        alt=""
        fill
        sizes="100vw"
        loading="lazy"
        className="absolute inset-y-0 right-0 -z-20 h-full w-[72rem] max-w-none object-cover opacity-45"
      />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,var(--background)_0%,color-mix(in_oklab,var(--background)_92%,transparent)_52%,color-mix(in_oklab,var(--background)_70%,transparent)_100%)]" />
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <Badge variant="secondary" className="w-fit">
          {eyebrow}
        </Badge>
        <div className="flex max-w-4xl flex-col gap-4">
          <h1 className="text-4xl font-semibold leading-tight text-balance md:text-6xl">
            {title}
          </h1>
          <p className="max-w-3xl text-base leading-7 text-muted-foreground md:text-xl">
            {description}
          </p>
        </div>
        {children ? <div className="flex flex-col gap-3 sm:flex-row">{children}</div> : null}
      </div>
    </section>
  );
}
