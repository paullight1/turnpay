import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://trustpay.xyz";

// Public marketing routes only. /admin and /dashboard are intentionally excluded
// (also disallowed in robots.ts).
const PUBLIC_ROUTES = [
  "",
  "/about",
  "/blog",
  "/company",
  "/download",
  "/exchange",
  "/features",
  "/legal",
  "/pricing",
  "/security",
  "/support",
  "/vtu",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified,
    changeFrequency: "weekly",
    priority: route === "" ? 1 : 0.7,
  }));
}
