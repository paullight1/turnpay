import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL;
const LEGACY_CHUNK_COUNT = 8;

const authSessionSchema = z.object({
  session: z
    .object({
      access_token: z.string().min(1),
      refresh_token: z.string().min(1),
      expires_at: z.number().int().positive(),
      expires_in: z.number().int().positive(),
      token_type: z.string().min(1),
      authMode: z.enum(["supabase", "local"]).optional(),
      user: z.object({}).passthrough(),
    })
    .passthrough(),
});

function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", getSessionCookieOptions(0));

  for (let index = 0; index < LEGACY_CHUNK_COUNT; index += 1) {
    response.cookies.set(
      `${SESSION_COOKIE_NAME}.${index}`,
      "",
      getSessionCookieOptions(0),
    );
  }
}

function clearCsrfCookie(response: NextResponse) {
  response.cookies.set(CSRF_COOKIE_NAME, "", getCsrfCookieOptions(0));
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

// Verifies the submitted access token before we mint a long-lived cookie so we
// never persist a session for unauthenticated input. Handles both Supabase- and
// backend-issued ("local" mode) tokens.
async function verifyAccessToken(accessToken: string): Promise<boolean> {
  if (supabaseUrl && supabaseAnonKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await supabase.auth.getUser(accessToken);
      if (!error && data.user) {
        return true;
      }
    } catch {
      // Fall through to backend verification for non-Supabase tokens.
    }
  }

  try {
    const bootstrapUrl = apiBaseUrl
      ? `${apiBaseUrl.replace(/\/$/, "")}/api/auth/bootstrap`
      : "https://api.trustpay.xyz/api/auth/bootstrap";
    const res = await fetch(bootstrapUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.ok;
  } catch {
    return false;
  }
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

  const isValid = await verifyAccessToken(parsed.data.session.access_token);
  if (!isValid) {
    return NextResponse.json(
      { message: "Invalid or unverifiable access token" },
      { status: 401 },
    );
  }

  const csrfToken = getRequestCookies(request)[CSRF_COOKIE_NAME] || mintCsrfToken();
  const response = NextResponse.json({
    success: true,
    session: buildClientSession(parsed.data.session),
    csrfToken,
  });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    encodeSessionCookie(parsed.data.session),
    getSessionCookieOptions(),
  );
  for (let index = 0; index < LEGACY_CHUNK_COUNT; index += 1) {
    response.cookies.set(
      `${SESSION_COOKIE_NAME}.${index}`,
      "",
      getSessionCookieOptions(0),
    );
  }
  response.cookies.set(CSRF_COOKIE_NAME, csrfToken, getCsrfCookieOptions());
  return response;
}

export async function PUT(request: Request) {
  if (!isSameOrigin(request) || !hasValidCsrfToken(request)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const storedSession = readStoredSession(request);
  if (!storedSession?.refresh_token) {
    const response = NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    clearSessionCookie(response);
    clearCsrfCookie(response);
    return response;
  }

  const refreshedSession = await refreshSessionWithBackend(storedSession, request);
  if (!refreshedSession) {
    const response = NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    clearSessionCookie(response);
    clearCsrfCookie(response);
    return response;
  }

  const csrfToken = getRequestCookies(request)[CSRF_COOKIE_NAME] || mintCsrfToken();
  const response = NextResponse.json({
    success: true,
    session: buildClientSession(refreshedSession),
    csrfToken,
  });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    encodeSessionCookie(refreshedSession),
    getSessionCookieOptions(),
  );
  for (let index = 0; index < LEGACY_CHUNK_COUNT; index += 1) {
    response.cookies.set(
      `${SESSION_COOKIE_NAME}.${index}`,
      "",
      getSessionCookieOptions(0),
    );
  }
  response.cookies.set(CSRF_COOKIE_NAME, csrfToken, getCsrfCookieOptions());
  return response;
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request) || !hasValidCsrfToken(request)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  clearCsrfCookie(response);
  return response;
}

export async function GET(request: Request) {
  const storedSession = readStoredSession(request);
  const csrfToken = getRequestCookies(request)[CSRF_COOKIE_NAME] || mintCsrfToken();
  const response = NextResponse.json({
    session: storedSession ? buildClientSession(storedSession) : null,
    csrfToken,
  });

  response.cookies.set(CSRF_COOKIE_NAME, csrfToken, getCsrfCookieOptions());
  return response;
}
