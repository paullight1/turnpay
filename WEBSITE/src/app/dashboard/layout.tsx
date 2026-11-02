import { redirect } from "next/navigation";
import { headers } from "next/headers";

// Customer wallet services are mobile-only. Staff are routed to /admin by the
// proxy; this server boundary also prevents the old pages from rendering.
export default async function RetiredCustomerWebLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Only the local QA runner may render retained customer pages. Production
  // remains mobile-only, independently of proxy or browser routing.
  const token = process.env.TRUSTPAY_E2E_AUTH_BYPASS_TOKEN;
  if (
    process.env.NODE_ENV !== "production" &&
    token &&
    (await headers()).get("x-trustpay-e2e-auth") === token
  )
    return children;
  redirect("/download");
}
