import { TrustPayLogo } from "@/components/brand/trustpay-logo";
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
    <main className="dark relative isolate min-h-screen overflow-hidden bg-[#050505] text-white">
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_50%_0%,rgba(255,107,10,0.22),transparent_32%)]" />
      <div className="absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-orange-400/50 to-transparent" />

      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-6xl items-center gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]">
        <section className="max-w-xl text-balance">
          <TrustPayLogo imageClassName="size-12" textClassName="text-2xl font-black" />
          <h1 className="mt-5 text-4xl font-black leading-tight text-white sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-white/58">
            {subtitle}
          </p>
        </section>

        <Card
          className={`w-full ${maxWidth} justify-self-center border-white/10 bg-[#111111] text-white shadow-2xl shadow-black/45 animate-trustpay-fade-up`}
        >
          {children}
        </Card>
      </div>
    </main>
  );
}
