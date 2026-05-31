import Image from "next/image";
import { Card } from "@/components/ui/card";

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  maxWidth?: string;
};

export function AuthShell({
  title,
  subtitle,
  children,
  maxWidth = "max-w-md",
}: AuthShellProps) {
  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-background text-foreground">
      <Image
        src="/trustpay-hero.svg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="absolute inset-0 -z-30 object-cover object-center opacity-95 dark:opacity-70"
      />
      <div className="absolute inset-0 -z-20 bg-[linear-gradient(180deg,rgba(247,243,236,0.18)_0%,rgba(247,243,236,0.78)_58%,#f7f3ec_100%)] dark:bg-[linear-gradient(180deg,rgba(8,10,9,0.36)_0%,rgba(8,10,9,0.86)_55%,#080a09_100%)]" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-[62%] bg-[linear-gradient(0deg,var(--background)_0%,color-mix(in_oklab,var(--background)_82%,transparent)_56%,transparent_100%)]" />

      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-6xl items-end gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)] lg:items-center lg:py-10">
        <section className="max-w-xl pb-2 text-balance lg:pb-16">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
            TRUSTPAY
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight text-foreground sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-muted-foreground">
            {subtitle}
          </p>
        </section>

        <Card
          className={`w-full ${maxWidth} justify-self-center border-border bg-card shadow-2xl shadow-black/20 animate-trustpay-fade-up dark:shadow-black/45`}
        >
          {children}
        </Card>
      </div>
    </main>
  );
}
