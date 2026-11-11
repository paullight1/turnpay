"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  theme: Theme;
};

const STORAGE_KEY = "trustpay-theme";
const THEME_CHANGE = "trustpay-theme-change";
const SYSTEM_DARK = "(prefers-color-scheme: dark)";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function subscribeTheme(onChange: () => void) {
  window.addEventListener(THEME_CHANGE, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE, onChange);
    window.removeEventListener("storage", onChange);
  };
}

let sessionTheme: Theme | null = null;

function getStoredTheme() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : null;
  } catch {
    return sessionTheme;
  }
}

function setTheme(theme: Theme) {
  sessionTheme = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage may be disabled. Keep the choice for this page session.
  }
  window.dispatchEvent(new Event(THEME_CHANGE));
}

function subscribeSystemTheme(onChange: () => void) {
  const media = window.matchMedia(SYSTEM_DARK);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname === "/admin" || pathname?.startsWith("/admin/");
  const preference = useSyncExternalStore(subscribeTheme, getStoredTheme, () => null);
  const prefersDark = useSyncExternalStore(
    subscribeSystemTheme,
    () => window.matchMedia(SYSTEM_DARK).matches,
    () => false,
  );
  const theme = preference ?? (isAdmin ? "dark" : "system");
  const resolvedTheme = theme === "system" ? (prefersDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme]);

  return (
    <ThemeContext.Provider value={{ resolvedTheme, setTheme, theme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTrustpayTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTrustpayTheme must be used within ThemeProvider");
  }

  return context;
}
