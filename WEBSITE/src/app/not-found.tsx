import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#030403] px-4 py-16 text-center text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_22%,rgba(255,107,10,0.22),transparent_34%),linear-gradient(180deg,#07100c_0%,#030403_62%)]" />
      <div className="relative mx-auto max-w-2xl">
        <div className="mx-auto flex size-44 items-center justify-center rounded-full border border-orange-300/20 bg-orange-500/10 shadow-[0_0_70px_rgba(255,107,10,0.24)] md:size-56">
          <span className="text-6xl font-black leading-none text-orange-400 md:text-8xl">
            404
          </span>
        </div>
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">
          Page not found
        </p>
        <h1 className="mt-3 text-4xl font-black leading-tight text-white md:text-6xl">
          This TrustPay page is missing
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-white/56 md:text-base">
          The page you are looking for does not exist or may have moved.
        </p>
        <Link href="/" className="mt-8 inline-flex">
          <Button className="rounded-full bg-orange-500 px-6 text-white hover:bg-orange-400">
            Go Home
          </Button>
        </Link>
      </div>
    </div>
  );
}
