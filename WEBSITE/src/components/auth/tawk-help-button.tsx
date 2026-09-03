"use client";

declare global {
  interface Window {
    Tawk_API?: {
      hideWidget?: () => void;
      showWidget?: () => void;
      maximize?: () => void;
    };
  }
}

export function TawkHelpButton() {
  return (
    <button
      type="button"
      onClick={() => window.Tawk_API?.maximize?.()}
      className="inline-flex h-9 items-center gap-2 rounded-full border border-white/12 bg-white/[0.08] px-3 text-xs font-semibold text-white/84 transition hover:bg-white/[0.14] hover:text-white focus-visible:ring-3 focus-visible:ring-red-400/50"
    >
      Get help
    </button>
  );
}
