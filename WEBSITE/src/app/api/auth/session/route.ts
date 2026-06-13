import { NextResponse } from "next/server";
import { z } from "zod";

const SESSION_COOKIE_NAME = "supabase.auth.token";
const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const CHUNK_COUNT = 8;

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
    sameSite: "lax",
  });

  for (let index = 0; index < CHUNK_COUNT; index += 1) {
    response.cookies.set(`${SESSION_COOKIE_NAME}.${index}`, "", {
      path: "/",
      maxAge: 0,
      sameSite: "lax",
    });
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let body: unknown = null;

  if (contentType.includes("application/json")) {
    body = await request.json().catch(() => null);
  } else {
    const formData = await request.formData().catch(() => null);
    if (formData) {
      const session = formData.get("session");
      try {
        body =
          typeof session === "string"
            ? { session: JSON.parse(session) }
            : { session: null };
      } catch {
        body = { session: null };
      }
    }
  }

  const parsed = authSessionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid auth session payload" },
      { status: 400 },
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, encodeSessionCookie(parsed.data.session), {
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
  });

  for (let index = 0; index < CHUNK_COUNT; index += 1) {
    response.cookies.set(`${SESSION_COOKIE_NAME}.${index}`, "", {
      path: "/",
      maxAge: 0,
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
