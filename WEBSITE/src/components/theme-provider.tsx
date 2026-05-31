"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  theme: Theme;
};

const STORAGE_KEY = "trustpay-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme, resolvedTheme: ResolvedTheme) {
  document.documentElement.classList.toggle(
    "dark",
    theme === "dark" || (theme === "system" && resolvedTheme === "dark"),
  );
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    applyTheme(theme, resolvedTheme);
  }, [resolvedTheme, theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function handleSystemThemeChange() {
      const nextResolvedTheme = getSystemTheme();

      if (theme === "system") {
        applyTheme(theme, nextResolvedTheme);
      }

      setResolvedTheme(nextResolvedTheme);
    }

    mediaQuery.addEventListener("change", handleSystemThemeChange);

    return () => {
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
    };
  }, [theme]);

  const setTheme = useCallback((nextTheme: Theme) => {
    const nextResolvedTheme =
      nextTheme === "system" ? getSystemTheme() : nextTheme;

    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    setThemeState(nextTheme);
    setResolvedTheme(nextResolvedTheme);
    applyTheme(nextTheme, nextResolvedTheme);
  }, []);

  const value = useMemo(
    () => ({ resolvedTheme, setTheme, theme }),
    [resolvedTheme, setTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTrustpayTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTrustpayTheme must be used within ThemeProvider");
  }

  return context;
}
