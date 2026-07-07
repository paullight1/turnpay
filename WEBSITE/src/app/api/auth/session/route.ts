import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const SESSION_COOKIE_NAME = "supabase.auth.token";
const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const CHUNK_COUNT = 8;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL;

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

function encodeSessionCookie(session: unknown) {
  const json = JSON.stringify(session);
  return `base64-${Buffer.from(json, "utf8").toString("base64url")}`;
}

function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
  });

  for (let index = 0; index < CHUNK_COUNT; index += 1) {
    response.cookies.set(`${SESSION_COOKIE_NAME}.${index}`, "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
  }
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
    // No Origin header (e.g. same-origin GET-like POST from older browsers).
    // Sec-Fetch-Site is the primary control above; treat absence as same-origin.
    return true;
  }

  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
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
  // The legacy hidden-iframe form POST path has been removed to close a CSRF
  // session-fixation vector. Only same-origin JSON is accepted.
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

  const response = NextResponse.json({ success: true });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    encodeSessionCookie(parsed.data.session),
    {
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    },
  );

  for (let index = 0; index < CHUNK_COUNT; index += 1) {
    response.cookies.set(`${SESSION_COOKIE_NAME}.${index}`, "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
  }

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}

export async function GET(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const hasSessionCookie = cookieHeader.includes(`${SESSION_COOKIE_NAME}=`);

  return NextResponse.json({ hasSessionCookie });
}
