"use client";

import { SunMoon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTrustpayTheme } from "@/components/theme-provider";

export function ThemeToggle({
  className,
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { resolvedTheme, theme, setTheme } = useTrustpayTheme();
  const currentTheme = resolvedTheme ?? theme;
  const isLight = currentTheme === "light";

  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? "default" : "icon"}
      className={className}
      aria-label="Toggle color theme"
      title="Toggle color theme"
      onClick={() => setTheme(isLight ? "dark" : "light")}
    >
      <SunMoon aria-hidden="true" className="size-4" />
      {showLabel && "Color theme"}
    </Button>
  );
}
