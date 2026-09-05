"use client";

import { useEffect } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";

declare global {
  interface Window {
    Tawk_API?: {
      hideWidget?: () => void;
      showWidget?: () => void;
      maximize?: () => void;
    };
    Tawk_LoadStart?: Date;
  }
}

export function SupportWidget() {
  const pathname = usePathname();
  const isProtectedRoute =
    pathname === "/staff" ||
    pathname.startsWith("/staff/") ||
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/");

  useEffect(() => {
    if (isProtectedRoute) {
      window.Tawk_API?.hideWidget?.();
      return;
    }
    window.Tawk_API?.showWidget?.();
  }, [isProtectedRoute]);

  if (isProtectedRoute) return null;

  return (
    <Script id="tawk-to" strategy="lazyOnload">
      {`
        window.Tawk_API = window.Tawk_API || {};
        window.Tawk_LoadStart = new Date();
        (function () {
          var s1 = document.createElement("script"), s0 = document.getElementsByTagName("script")[0];
          s1.async = true;
          s1.src = "https://embed.tawk.to/6a1d1a71e29f411c2ce86741/1jq0quiuh";
          s1.charset = "UTF-8";
          s1.setAttribute("crossorigin", "anonymous");
          s0.parentNode.insertBefore(s1, s0);
        })();
      `}
    </Script>
  );
}
