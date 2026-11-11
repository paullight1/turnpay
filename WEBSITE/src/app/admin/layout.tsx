import { hasAdminAccess } from "@/lib/admin-access";
import {
  DEFAULT_API_ORIGIN,
  resolveApiOrigin,
} from "@/lib/api-origin";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decodeSessionCookie, SESSION_COOKIE_NAME } from "@/lib/server-auth-session";
import { createServerClientInstance } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Admin",
  description: "TrustPay internal operations workspace.",
  robots: { index: false, follow: false },
};

const apiBaseUrl = resolveApiOrigin(undefined, {
  fallback: DEFAULT_API_ORIGIN,
});

// Confirms the admin role from a trusted server call (backend /api/auth/bootstrap),
// never from client-editable Supabase user_metadata.
async function verifyAdminRole(accessToken: string): Promise<boolean> {
  try {
    const bootstrapUrl = apiBaseUrl
      ? `${apiBaseUrl.replace(/\/$/, "")}/api/auth/bootstrap`
      : "https://api.trustpayhq.com/api/auth/bootstrap";

    const res = await fetch(bootstrapUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Idempotency-Key": `bootstrap:${crypto.randomUUID()}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return false;
    }

    const data = (await res.json().catch(() => null)) as {
      user?: { role?: string; canAccessAdmin?: boolean };
    } | null;
    return hasAdminAccess(data?.user);
  } catch {
    return false;
  }
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defense in depth: the middleware already gates /admin, but we re-verify the
  // role from a trusted server call here so a page render can never rely on
  // client-side user_metadata for authorization.
  const cookieStore = await cookies();
  let candidateToken = decodeSessionCookie(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
  )?.access_token ?? null;
  const supabase = candidateToken ? null : await createServerClientInstance();
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      candidateToken = session?.access_token ?? null;
    }
  }

  if (!candidateToken) {
    redirect("/staff");
  }

  const isAdmin = await verifyAdminRole(candidateToken);
  if (!isAdmin) {
    redirect("/staff");
  }

  return <>{children}</>;
}
