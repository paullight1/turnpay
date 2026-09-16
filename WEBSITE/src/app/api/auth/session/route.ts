import { NextResponse } from "next/server";
import { hasAdminAccess } from "@/lib/admin-access";
import {
  DEFAULT_API_ORIGIN,
  resolveApiOrigin,
} from "@/lib/api-origin";
import { z } from "zod";
import {
  buildClientSession,
  CSRF_COOKIE_NAME,
  decodeSessionCookie,
  getCsrfCookieOptions,
  getRequestCookies,
  getSessionCookieOptions,
  mintCsrfToken,
  refreshSessionWithBackend,
  SESSION_COOKIE_NAME,
  encodeSessionCookie,
} from "@/lib/server-auth-session";

const apiBaseUrl = resolveApiOrigin(undefined, {
  fallback: DEFAULT_API_ORIGIN,
});
const LEGACY_CHUNK_COUNT = 8;

const authSessionSchema = z.object({
  session: z
    .object({
      access_token: z.string().min(1),
      refresh_token: z.string().min(1),
      expires_at: z.number().int().positive(),
      // Supabase setSession computes exp - Date.now()/1000, so this may
      // contain fractional seconds. Normalize using expires_at below.
      expires_in: z.number().positive().optional(),
      token_type: z.string().min(1),
      authMode: z.enum(["supabase", "local"]).optional(),
      user: z.object({}).passthrough(),
    })
    .passthrough(),
});

function clearSessionCookie(response: NextResponse, requestUrl: string) {
  response.cookies.set(
    SESSION_COOKIE_NAME,
    "",
    getSessionCookieOptions(0, requestUrl),
  );

  for (let index = 0; index < LEGACY_CHUNK_COUNT; index += 1) {
    response.cookies.set(
      `${SESSION_COOKIE_NAME}.${index}`,
      "",
      getSessionCookieOptions(0, requestUrl),
    );
  }
}

function clearCsrfCookie(response: NextResponse, requestUrl: string) {
  response.cookies.set(
    CSRF_COOKIE_NAME,
    "",
    getCsrfCookieOptions(0, requestUrl),
  );
}

// Rejects cross-site requests to prevent CSRF session fixation. Same-origin
// fetches send Sec-Fetch-Site: same-origin; browsers that omit it fall back to
// an Origin host comparison.
function isSameOrigin(request: Request) {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite) {
    return secFetchSite === "same-origin" || secFetchSite === "none";
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function hasValidCsrfToken(request: Request) {
  const cookies = getRequestCookies(request);
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken = request.headers.get("x-csrf-token");

  return Boolean(cookieToken && headerToken && cookieToken === headerToken);
}

function readStoredSession(request: Request) {
  const cookies = getRequestCookies(request);
  return decodeSessionCookie(cookies[SESSION_COOKIE_NAME]);
}

// Website sessions require server-verified staff access. Token validity alone
// is insufficient; customer authentication remains available through the app.
async function verifyAccessToken(accessToken: string): Promise<200 | 401 | 403> {
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
    if (!res.ok) return 401;
    const data = await res.json();
    return hasAdminAccess(data?.user) ? 200 : 403;
  } catch {
    return 401;
  }
}

function deniedSession(status: 401 | 403, requestUrl: string) {
  const response = NextResponse.json(status === 403
    ? { code: 'STAFF_WEB_ONLY', message: 'Customer accounts use the TrustPay mobile app. Website access is for staff only.' }
    : { message: 'Invalid or unverifiable access token' }, { status });
  clearSessionCookie(response, requestUrl);
  clearCsrfCookie(response, requestUrl);
  return response;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json(
      { message: "Unsupported content type" },
      { status: 415 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = authSessionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid auth session payload" },
      { status: 400 },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = parsed.data.session.expires_at;
  const expiresIn = Math.max(1, expiresAt - now);
  const normalizedSession = {
    ...parsed.data.session,
    expires_at: expiresAt,
    expires_in: expiresIn,
  };

  const access = await verifyAccessToken(normalizedSession.access_token);
  if (access !== 200) return deniedSession(access, request.url);

  const csrfToken =
    getRequestCookies(request)[CSRF_COOKIE_NAME] || mintCsrfToken();
  const response = NextResponse.json({
    success: true,
    session: buildClientSession(normalizedSession),
    csrfToken,
  });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    encodeSessionCookie(normalizedSession),
    getSessionCookieOptions(undefined, request.url),
  );
  for (let index = 0; index < LEGACY_CHUNK_COUNT; index += 1) {
    response.cookies.set(
      `${SESSION_COOKIE_NAME}.${index}`,
      "",
      getSessionCookieOptions(0, request.url),
    );
  }
  response.cookies.set(
    CSRF_COOKIE_NAME,
    csrfToken,
    getCsrfCookieOptions(undefined, request.url),
  );
  return response;
}

export async function PUT(request: Request) {
  if (!isSameOrigin(request) || !hasValidCsrfToken(request)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const storedSession = readStoredSession(request);
  if (!storedSession?.refresh_token) {
    const response = NextResponse.json(
      { message: "Unauthorized" },
      { status: 401 },
    );
    clearSessionCookie(response, request.url);
    clearCsrfCookie(response, request.url);
    return response;
  }

  const refreshedSession = await refreshSessionWithBackend(
    storedSession,
    request,
  );
  if (!refreshedSession) {
    const response = NextResponse.json(
      { message: "Unauthorized" },
      { status: 401 },
    );
    clearSessionCookie(response, request.url);
    clearCsrfCookie(response, request.url);
    return response;
  }
  const access = await verifyAccessToken(refreshedSession.access_token);
  if (access !== 200) return deniedSession(access, request.url);

  const csrfToken =
    getRequestCookies(request)[CSRF_COOKIE_NAME] || mintCsrfToken();
  const response = NextResponse.json({
    success: true,
    session: buildClientSession(refreshedSession),
    csrfToken,
  });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    encodeSessionCookie(refreshedSession),
    getSessionCookieOptions(undefined, request.url),
  );
  for (let index = 0; index < LEGACY_CHUNK_COUNT; index += 1) {
    response.cookies.set(
      `${SESSION_COOKIE_NAME}.${index}`,
      "",
      getSessionCookieOptions(0, request.url),
    );
  }
  response.cookies.set(
    CSRF_COOKIE_NAME,
    csrfToken,
    getCsrfCookieOptions(undefined, request.url),
  );
  return response;
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request) || !hasValidCsrfToken(request)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookie(response, request.url);
  clearCsrfCookie(response, request.url);
  return response;
}

export async function GET(request: Request) {
  const storedSession = readStoredSession(request);
  if (storedSession) {
    const activeSession = storedSession.expires_at <= Math.floor(Date.now()/1000)
      ? await refreshSessionWithBackend(storedSession, request) : storedSession;
    if (!activeSession) return deniedSession(401, request.url);
    const access = await verifyAccessToken(activeSession.access_token);
    if (access !== 200) return deniedSession(access, request.url);
    Object.assign(storedSession, activeSession);
  }
  const csrfToken =
    getRequestCookies(request)[CSRF_COOKIE_NAME] || mintCsrfToken();
  const response = NextResponse.json({
    session: storedSession ? buildClientSession(storedSession) : null,
    csrfToken,
  });
  if (storedSession) response.cookies.set(SESSION_COOKIE_NAME, encodeSessionCookie(storedSession), getSessionCookieOptions(undefined, request.url));

  response.cookies.set(
    CSRF_COOKIE_NAME,
    csrfToken,
    getCsrfCookieOptions(undefined, request.url),
  );
  return response;
}
