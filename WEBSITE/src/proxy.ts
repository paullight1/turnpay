import { hasAdminAccess } from "@/lib/admin-access";
import {
  DEFAULT_API_ORIGIN,
  resolveApiOrigin,
} from "@/lib/api-origin";
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
const apiBaseUrl = resolveApiOrigin(undefined, {
  fallback: DEFAULT_API_ORIGIN,
});

const SUPABASE_ORIGIN = resolvePublicHttpOrigin(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);
const TAWK_HTTPS =
  "https://*.tawk.to https://embed.tawk.to https://va.tawk.to";
const TAWK_WSS = "wss://*.tawk.to";

function resolvePublicHttpOrigin(value: string | undefined) {
  if (!value) return "";

  try {
    const url = new URL(value);
    const isLoopbackHttp =
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || isLoopbackHttp ? url.origin : "";
  } catch {
    return "";
  }
}

function createContentSecurityPolicy(nonce: string) {
  const isDev = process.env.NODE_ENV !== "production";
  const devScriptPolicy = isDev ? " 'unsafe-eval'" : "";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    // React style props render style attributes; keep those working while
    // protecting every executable inline script with the request nonce.
    "style-src 'self' 'unsafe-inline' https://*.tawk.to",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devScriptPolicy} https://embed.tawk.to https://*.tawk.to`,
    `connect-src 'self' ${apiBaseUrl} ${SUPABASE_ORIGIN} https://*.supabase.co ${TAWK_HTTPS} ${TAWK_WSS} ${isDev ? "http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*" : ""}`
      .replace(/\s+/g, " ")
      .trim(),
    `frame-src 'self' ${TAWK_HTTPS}`,
  ]
    .join("; ")
    .replace(/\s+/g, " ")
    .trim();
}

const PROTECTED_ROUTES = ["/dashboard"];
const AUTH_ROUTES = ["/login", "/register"];

function isAdminPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function getStaffDestination(request: NextRequest) {
  const callback = request.nextUrl.searchParams.get("callbackUrl");
  if (callback?.startsWith("/") && URL.canParse(callback, request.url)) {
    const destination = new URL(callback, request.url);
    if (
      destination.origin === request.nextUrl.origin &&
      isAdminPath(destination.pathname)
    ) {
      return destination;
    }
  }
  return new URL("/admin", request.url);
}

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
): Promise<{ ok: boolean; status?: number; role?: string; canAccessAdmin?: boolean }> {
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
      return { ok: false, status: res.status };
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
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = createContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);

  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  const isAdmin = isAdminPath(pathname);
  const isStaffPage = pathname === "/staff";

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
    url.searchParams.set("callbackUrl", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  };

  const withSessionCookies = (next: NextResponse) => {
    for (const cookie of response.cookies.getAll()) {
      next.cookies.set(cookie);
    }
    return next;
  };

  // Browser mocks cannot intercept this server-side guard's backend request.
  // A random token shared only with the local Playwright child process keeps
  // authenticated E2E tests realistic without weakening production or admin.
  if (isProtected && hasLocalE2EAuth) {
    return response;
  }

  // Staff navigation uses the same HttpOnly session as /api/auth/session.
  // Every candidate still needs backend verification before granting access.
  let hasVerifiedSupabaseUser = false;
  let candidateToken = isAdmin || isStaffPage
    ? readLocalSessionCandidateToken(request)
    : null;

  if (!candidateToken && supabaseUrl && supabaseAnonKey) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
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

  if (isAdmin || isStaffPage) {
    if (!candidateToken) {
      return isAdmin ? redirectToLogin() : response;
    }

    let result = await verifyWithBackend(candidateToken, request);
    if (result.status === 401) {
      const refreshedToken = await refreshCookieBackedSession(
        request,
        response,
      );
      if (refreshedToken) {
        result = await verifyWithBackend(refreshedToken, request);
      }
    }
    if (!result.ok || !hasAdminAccess(result)) {
      return isAdmin ? withSessionCookies(redirectToLogin()) : response;
    }

    if (isStaffPage) {
      return withSessionCookies(NextResponse.redirect(getStaffDestination(request)));
    }

    if (!response.cookies.getAll().length) return response;

    // The layout independently verifies the session. Give it the same cookies
    // as the browser receives so it does not check an expired access token.
    for (const { name, value } of response.cookies.getAll()) {
      request.cookies.set(name, value);
    }
    requestHeaders.set("cookie", request.cookies.toString());
    const next = NextResponse.next({ request: { headers: requestHeaders } });
    next.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return withSessionCookies(next);
  }

  if (isProtected) {
    // Staff use the operations workspace, including when they follow an old
    // customer bookmark. Classify access from backend-verified capabilities.
    const workspaceResponse = (result: {
      role?: string;
      canAccessAdmin?: boolean;
    }) => withSessionCookies(NextResponse.redirect(
      new URL(hasAdminAccess(result) ? "/admin" : "/download", request.url),
    ));
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
  matcher: [
    {
      // Apply the nonce to every HTML/RSC page while leaving API handlers and
      // static assets on their own response path.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
    },
  ],
};
