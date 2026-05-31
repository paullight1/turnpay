"use client";

import { useEffect, useState } from "react";
import Lottie from "lottie-react";
import loadingAnimation from "@/assets/animations/trustpay-loading.json";
import sendAnimation from "@/assets/animations/trustpay-send.json";
import successAnimation from "@/assets/animations/trustpay-success.json";
import { cn } from "@/lib/utils";

const animations = {
  loading: loadingAnimation,
  send: sendAnimation,
  success: successAnimation,
} as const;

const fallbackLabels = {
  loading: "Loading",
  send: "Sending",
  success: "Complete",
} as const;

type TrustPayAnimationVariant = keyof typeof animations;

export function TrustPayAnimation({
  variant,
  className,
  loop,
  label,
}: {
  variant: TrustPayAnimationVariant;
  className?: string;
  loop?: boolean;
  label?: string;
}) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  if (prefersReducedMotion) {
    return (
      <div
        aria-label={label ?? fallbackLabels[variant]}
        className={cn(
          "flex size-16 items-center justify-center rounded-full border bg-muted text-xs font-medium text-muted-foreground",
          className,
        )}
      >
        {fallbackLabels[variant]}
      </div>
    );
  }

  return (
    <Lottie
      animationData={animations[variant]}
      aria-label={label ?? fallbackLabels[variant]}
      className={cn("size-16", className)}
      loop={loop ?? variant !== "success"}
      autoplay
    />
  );
}
