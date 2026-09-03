import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClientInstance } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Admin",
  description: "TrustPay internal operations workspace.",
  robots: { index: false, follow: false },
};

const LOCAL_SESSION_COOKIE_NAME = "supabase.auth.token";
const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL;

type LocalSessionCookie = { access_token?: string };

// Recovers a candidate bearer token from the locally-persisted cookie. NOT
// trusted on its own — always re-validated against the backend below.
function readLocalCandidateToken(value?: string): string | null {
  if (!value?.startsWith("base64-")) {
    return null;
  }

  try {
    const json = Buffer.from(
      value.slice("base64-".length),
      "base64url",
    ).toString("utf8");
    const parsed = JSON.parse(json) as LocalSessionCookie;
    return parsed.access_token ?? null;
  } catch {
    return null;
  }
}

// Confirms the admin role from a trusted server call (backend /api/auth/bootstrap),
// never from client-editable Supabase user_metadata.
async function verifyAdminRole(accessToken: string): Promise<boolean> {
  try {
    const bootstrapUrl = apiBaseUrl
      ? `${apiBaseUrl.replace(/\/$/, "")}/api/auth/bootstrap`
      : "https://api.trustpayhq.com/api/auth/bootstrap";

    const res = await fetch(bootstrapUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (!res.ok) {
      return false;
    }

    const data = (await res.json().catch(() => null)) as
      | { user?: { role?: string } }
      | null;
    return data?.user?.role === "ADMIN";
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
  const supabase = await createServerClientInstance();

  let candidateToken: string | null = null;
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
    const cookieStore = await cookies();
    candidateToken = readLocalCandidateToken(
      cookieStore.get(LOCAL_SESSION_COOKIE_NAME)?.value,
    );
  }

  if (!candidateToken) {
    redirect("/login");
  }

  const isAdmin = await verifyAdminRole(candidateToken);
  if (!isAdmin) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
