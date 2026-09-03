import type { NextConfig } from "next";

// Single source of truth for security headers (vercel.json no longer sets a
// competing header block). Pin allow-lists to the hosts we actually talk to.
const API_ORIGIN = "https://api.trustpay.xyz";
const SUPABASE_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const TAWK_HTTPS = "https://*.tawk.to https://embed.tawk.to https://va.tawk.to";
const TAWK_WSS = "wss://*.tawk.to";
const DEV_SCRIPT_POLICY =
  process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
// Dev-only origins so local API/Supabase/HMR still work outside production.
const DEV_ORIGINS =
  process.env.NODE_ENV === "production"
    ? ""
    : "http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline' https://*.tawk.to",
  // TODO(launch): replace 'unsafe-inline' scripts with a per-request nonce.
  // Webpack development builds require unsafe-eval. Production never receives it.
  `script-src 'self' 'unsafe-inline'${DEV_SCRIPT_POLICY} https://embed.tawk.to https://*.tawk.to`,
  `connect-src 'self' ${API_ORIGIN} ${SUPABASE_ORIGIN} https://*.supabase.co ${TAWK_HTTPS} ${TAWK_WSS} ${DEV_ORIGINS}`
    .replace(/\s+/g, " ")
    .trim(),
  `frame-src 'self' ${TAWK_HTTPS}`,
]
  .join("; ")
  .replace(/\s+/g, " ")
  .trim();

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: process.cwd(),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "img.icons8.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-XSS-Protection",
            value: "0",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: CONTENT_SECURITY_POLICY,
          },
        ],
      },
      {
        // Never cache authenticated surfaces (moved here from vercel.json so
        // headers have a single source of truth).
        source: "/dashboard/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/admin/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
