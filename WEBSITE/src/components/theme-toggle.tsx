"use client";

import { SunMoon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTrustpayTheme } from "@/components/theme-provider";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, theme, setTheme } = useTrustpayTheme();
  const currentTheme = resolvedTheme ?? theme;
  const isLight = currentTheme === "light";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      aria-label="Toggle color theme"
      title="Toggle color theme"
      onClick={() => setTheme(isLight ? "dark" : "light")}
    >
      <SunMoon className="size-4" />
    </Button>
  );
}
