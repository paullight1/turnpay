import { hasAdminAccess } from "@/lib/admin-access";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  decodeSessionCookie,
  encodeSessionCookie,
  getSessionCookieOptions,
  refreshSessionWithBackend,
  SESSION_COOKIE_NAME,
} from "@/lib/server-auth-session";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL;

const PROTECTED_ROUTES = ["/dashboard"];
const ADMIN_ROUTES = ["/admin"];
const AUTH_ROUTES = ["/login", "/register"];

// Reads the locally-persisted session cookie ONLY to recover a candidate
// bearer token. The presence/contents of this cookie are NOT trusted for
// authentication or authorization: the token is always re-validated against
// Supabase (getUser) or the backend (/api/auth/bootstrap) before access is
// granted. A forged cookie therefore grants nothing.
function readLocalSessionCandidateToken(request: NextRequest) {
  return (
    decodeSessionCookie(request.cookies.get(SESSION_COOKIE_NAME)?.value)
      ?.access_token ?? null
  );
}

// Verifies a bearer token against the backend, which validates the token
// signature (Supabase- or backend-issued) and returns the authoritative,
// server-derived role. This is the only trusted source of the admin role;
// Supabase user_metadata is user-editable and must never be used for authz.
async function verifyWithBackend(
  accessToken: string,
  request: NextRequest,
): Promise<{ ok: boolean; role?: string; canAccessAdmin?: boolean }> {
  try {
    const bootstrapUrl = apiBaseUrl
      ? `${apiBaseUrl.replace(/\/$/, "")}/api/auth/bootstrap`
      : new URL("/api/auth/bootstrap", request.url).toString();

    const res = await fetch(bootstrapUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Idempotency-Key": `bootstrap:${crypto.randomUUID()}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return { ok: false };
    }

    const data = (await res.json().catch(() => null)) as {
      user?: { role?: string; canAccessAdmin?: boolean };
    } | null;

    return {
      ok: true,
      role: data?.user?.role,
      canAccessAdmin: data?.user?.canAccessAdmin === true,
    };
  } catch {
    return { ok: false };
  }
}

async function refreshCookieBackedSession(
  request: NextRequest,
  response: NextResponse,
) {
  const storedSession = decodeSessionCookie(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );

  if (!storedSession?.refresh_token) {
    return null;
  }

  const refreshedSession = await refreshSessionWithBackend(
    storedSession,
    request,
  );
  if (!refreshedSession?.access_token) {
    response.cookies.set(
      SESSION_COOKIE_NAME,
      "",
      getSessionCookieOptions(0, request.url),
    );
    return null;
  }

  response.cookies.set(
    SESSION_COOKIE_NAME,
    encodeSessionCookie(refreshedSession),
    getSessionCookieOptions(undefined, request.url),
  );
  return refreshedSession.access_token;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === '/login') return NextResponse.redirect(new URL('/staff', request.url));
  if (pathname === '/register') return NextResponse.redirect(new URL('/download', request.url));
  const response = NextResponse.next();

  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  const isAdmin = ADMIN_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  const isAuthRoute = AUTH_ROUTES.includes(pathname);
  const localE2EAuthToken = process.env.TRUSTPAY_E2E_AUTH_BYPASS_TOKEN;
  const hasLocalE2EAuth = Boolean(
    process.env.NODE_ENV !== "production" &&
    localE2EAuthToken &&
    (request.headers.get("x-trustpay-e2e-auth") === localE2EAuthToken ||
      request.cookies.get("trustpay.e2e-auth")?.value === localE2EAuthToken),
  );

  const redirectToLogin = () => {
    const url = new URL(isAdmin ? "/staff" : "/login", request.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  };

  // Browser mocks cannot intercept this server-side guard's backend request.
  // A random token shared only with the local Playwright child process keeps
  // authenticated E2E tests realistic without weakening production or admin.
  if (isProtected && hasLocalE2EAuth) {
    return response;
  }

  // Candidate bearer token for backend verification. Prefer a Supabase-
  // validated session when Supabase is configured; otherwise use the local
  // cookie only as a candidate that must still pass backend verification.
  // This keeps backend-issued local sessions usable without weakening the
  // fail-closed behavior for forged or unverifiable cookies.
  let hasVerifiedSupabaseUser = false;
  let candidateToken: string | null = null;

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });

    // getUser() validates the JWT signature against Supabase (unlike
    // getSession(), which only decodes the cookie).
    const {
      data: { user },
    } = await supabase.auth.getUser();

    hasVerifiedSupabaseUser = Boolean(user);
    if (user) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      candidateToken = session?.access_token ?? null;
    }
  }

  if (!candidateToken) {
    candidateToken = readLocalSessionCandidateToken(request);
  }

  if (isAdmin) {
    if (!candidateToken) {
      return redirectToLogin();
    }

    let result = await verifyWithBackend(candidateToken, request);
    if (!result.ok) {
      const refreshedToken = await refreshCookieBackedSession(
        request,
        response,
      );
      if (!refreshedToken) {
        return redirectToLogin();
      }

      candidateToken = refreshedToken;
      result = await verifyWithBackend(candidateToken, request);
      if (!result.ok) {
        return redirectToLogin();
      }
    }
    if (!hasAdminAccess(result)) {
      return NextResponse.redirect(new URL("/staff", request.url));
    }

    return response;
  }

  if (isProtected) {
    // Staff use the operations workspace, including when they follow an old
    // customer bookmark. Classify access from backend-verified capabilities.
    const workspaceResponse = (result: {
      role?: string;
      canAccessAdmin?: boolean;
    }) => {
      const redirect = NextResponse.redirect(new URL(hasAdminAccess(result) ? '/admin' : '/download', request.url));
      for (const cookie of response.cookies.getAll())
        redirect.cookies.set(cookie);
      return redirect;
    };
    if (candidateToken) {
      const result = await verifyWithBackend(candidateToken, request);
      if (result.ok) {
        return workspaceResponse(result);
      }

      const refreshedToken = await refreshCookieBackedSession(
        request,
        response,
      );
      if (refreshedToken) {
        const refreshedResult = await verifyWithBackend(
          refreshedToken,
          request,
        );
        if (refreshedResult.ok) return workspaceResponse(refreshedResult);
      }
    }

    return NextResponse.redirect(new URL('/download', request.url));
  }

  // Auth routes: only bounce away Supabase-verified users. We intentionally do
  // NOT redirect based on the unverified local cookie here, to avoid a redirect
  // loop if the backend is unreachable.
  if (isAuthRoute && hasVerifiedSupabaseUser) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/login", "/register"],
};
