"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#030403] px-4 py-16 text-center text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_22%,rgba(255,107,10,0.22),transparent_34%),linear-gradient(180deg,#07100c_0%,#030403_62%)]" />
      <div className="relative mx-auto max-w-xl">
        <div className="mx-auto grid size-40 place-items-center rounded-full border border-orange-300/20 bg-orange-500/10 shadow-[0_0_70px_rgba(255,107,10,0.24)]">
          <Image
            src="https://img.icons8.com/fluency/240/error.png"
            alt=""
            width={150}
            height={150}
            priority
            className="size-32 object-contain"
          />
        </div>
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">
          TrustPay error
        </p>
        <h1 className="mt-3 text-4xl font-black leading-tight text-white md:text-6xl">
          Something went wrong
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-white/56 md:text-base">
          We could not finish loading this page. Please try again, or return
          home and continue from a fresh session.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={reset} className="rounded-full bg-orange-500 px-6 text-white hover:bg-orange-400">
            Try Again
          </Button>
          <Link href="/">
            <Button variant="outline" className="rounded-full border-white/12 bg-white/[0.04] px-6 text-white hover:bg-white hover:text-black">
              Go Home
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
