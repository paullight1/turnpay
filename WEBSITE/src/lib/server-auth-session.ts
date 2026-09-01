import { randomUUID } from "crypto";

export const SESSION_COOKIE_NAME = "supabase.auth.token";
export const CSRF_COOKIE_NAME = "trustpay.csrf-token";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL;
const isSecureCookie = process.env.NODE_ENV === "production";

function isHttpLoopback(requestUrl?: string) {
  if (!requestUrl) {
    return false;
  }

  try {
    const url = new URL(requestUrl);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export type StoredSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: string;
  authMode?: "supabase" | "local";
  user: Record<string, unknown>;
  [key: string]: unknown;
};

export type ClientSession = Omit<StoredSession, "refresh_token"> & {
  refresh_token: "";
};

export function buildClientSession(session: StoredSession): ClientSession {
  return {
    ...session,
    refresh_token: "",
  };
}

export function encodeSessionCookie(session: StoredSession) {
  const json = JSON.stringify(session);
  return `base64-${Buffer.from(json, "utf8").toString("base64url")}`;
}

export function decodeSessionCookie(value?: string | null) {
  if (!value?.startsWith("base64-")) {
    return null;
  }

  try {
    return JSON.parse(
      Buffer.from(value.slice("base64-".length), "base64url").toString("utf8"),
    ) as StoredSession;
  } catch {
    return null;
  }
}

export function parseCookieHeader(cookieHeader: string) {
  return cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((cookies, entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return cookies;
      }

      const name = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

export function getRequestCookies(request: Request) {
  return parseCookieHeader(request.headers.get("cookie") ?? "");
}

export function getSessionCookieOptions(
  maxAge = SESSION_COOKIE_MAX_AGE_SECONDS,
  requestUrl?: string,
) {
  return {
    path: "/",
    maxAge,
    httpOnly: true,
    // Production cookies remain Secure everywhere except an explicitly
    // identified loopback HTTP origin used by local production-mode tests.
    secure: isSecureCookie && !isHttpLoopback(requestUrl),
    sameSite: "lax" as const,
  };
}

export function getCsrfCookieOptions(
  maxAge = SESSION_COOKIE_MAX_AGE_SECONDS,
  requestUrl?: string,
) {
  return {
    path: "/",
    maxAge,
    httpOnly: false,
    secure: isSecureCookie && !isHttpLoopback(requestUrl),
    sameSite: "strict" as const,
  };
}

export function mintCsrfToken() {
  return randomUUID();
}

export async function refreshSessionWithBackend(
  session: StoredSession,
  request?: Request,
) {
  const refreshUrl = apiBaseUrl
    ? `${apiBaseUrl.replace(/\/$/, "")}/api/auth/refresh`
    : "https://api.trustpay.xyz/api/auth/refresh";

  try {
    const response = await fetch(refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `session-refresh:${randomUUID()}`,
        ...(request?.headers.get("user-agent")
          ? { "User-Agent": request.headers.get("user-agent") as string }
          : {}),
      },
      body: JSON.stringify({
        refreshToken: session.refresh_token,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json().catch(() => null)) as
      | { session?: StoredSession | null }
      | null;

    if (!data?.session?.access_token || !data.session.refresh_token) {
      return null;
    }

    return data.session;
  } catch {
    return null;
  }
}
