import Image from "next/image";

import { cn } from "@/lib/utils";

type TrustPayLogoProps = {
  className?: string;
  imageClassName?: string;
  textClassName?: string;
  showText?: boolean;
};

export function TrustPayLogo({
  className,
  imageClassName,
  textClassName,
  showText = true,
}: TrustPayLogoProps) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2.5", className)} translate="no">
      <span className={cn("relative size-10 shrink-0 overflow-hidden", imageClassName)}>
        <Image
          src="/trustpay-logo.png"
          alt=""
          fill
          sizes="48px"
          className="object-contain"
          priority
        />
      </span>
      {showText ? (
        <span className={cn("min-w-0 text-lg font-semibold leading-none", textClassName)}>
          TrustPay
        </span>
      ) : null}
    </span>
  );
}
