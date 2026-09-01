"use client";

import type { Session } from "@supabase/supabase-js";

const SESSION_COOKIE_NAME = "supabase.auth.token";
const SESSION_STORAGE_KEY = "trustpay.auth.session";
const CHUNK_COUNT = 8;
const SESSION_REFRESH_BUFFER_SECONDS = 60;

type PersistedSession = Session & {
  authMode?: "supabase" | "local";
};

type SessionRouteResponse = {
  session: PersistedSession | null;
  csrfToken?: string;
};

let inMemorySession: PersistedSession | null = null;
let inMemoryCsrfToken: string | null = null;
let pendingSessionRead: Promise<PersistedSession | null> | null = null;

function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

function clearLegacySessionChunks() {
  clearCookie(SESSION_COOKIE_NAME);

  for (let index = 0; index < CHUNK_COUNT; index += 1) {
    clearCookie(`${SESSION_COOKIE_NAME}.${index}`);
  }
}

function isPersistedSession(candidate: unknown): candidate is PersistedSession {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "access_token" in candidate &&
    "refresh_token" in candidate &&
    "user" in candidate
  );
}

function isSessionExpiringSoon(session: PersistedSession) {
  return (
    (session.expires_at ?? 0) <=
    Math.floor(Date.now() / 1000) + SESSION_REFRESH_BUFFER_SECONDS
  );
}

async function parseSessionRouteResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | SessionRouteResponse
    | null;

  if (payload?.csrfToken) {
    inMemoryCsrfToken = payload.csrfToken;
  }

  return isPersistedSession(payload?.session) ? payload.session : null;
}

async function requestSession(method: "GET" | "PUT") {
  const response = await fetch("/api/auth/session", {
    method,
    cache: "no-store",
    headers:
      method === "PUT" && inMemoryCsrfToken
        ? {
            "x-csrf-token": inMemoryCsrfToken,
          }
        : undefined,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      inMemorySession = null;
      inMemoryCsrfToken = null;
    }
    return null;
  }

  return parseSessionRouteResponse(response);
}

export async function persistSupabaseSession(session: Session) {
  const persistedSession = session as PersistedSession;

  inMemorySession = persistedSession;
  if (typeof window === "undefined") {
    return;
  }

  clearLegacySessionChunks();

  if (typeof fetch === "function") {
    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ session: persistedSession }),
      });

      if (!response.ok) {
        throw new Error("Unable to create a secure session");
      }

      await parseSessionRouteResponse(response);

      // WebKit can resolve the POST before its Set-Cookie update is visible to
      // the next navigation. A same-origin read creates an ordering barrier and
      // also fails closed if the HttpOnly session was not actually persisted.
      const confirmedSession = await requestSession("GET");
      if (confirmedSession?.access_token !== persistedSession.access_token) {
        throw new Error("Unable to confirm the secure session");
      }
    } catch (error) {
      inMemorySession = null;
      throw error;
    }
  }

  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures when clearing stale state.
  }
}

export async function refreshPersistedSupabaseSession() {
  if (typeof window === "undefined") {
    return inMemorySession;
  }

  try {
    const refreshedSession = await requestSession("PUT");
    inMemorySession = refreshedSession;
    return refreshedSession;
  } catch {
    return null;
  }
}

export async function clearSupabaseSession() {
  inMemorySession = null;
  if (typeof window === "undefined") {
    return;
  }

  clearLegacySessionChunks();

  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures when clearing stale state.
  }

  if (typeof fetch === "function") {
    try {
      await fetch("/api/auth/session", {
        method: "DELETE",
        headers: inMemoryCsrfToken
          ? {
              "x-csrf-token": inMemoryCsrfToken,
            }
          : undefined,
      });
    } catch {
      // Ignore route failures when clearing stale state.
    }
  }

  inMemoryCsrfToken = null;
}

export async function readPersistedSupabaseSession() {
  if (inMemorySession && !isSessionExpiringSoon(inMemorySession)) {
    return inMemorySession;
  }

  if (pendingSessionRead) {
    return pendingSessionRead;
  }

  pendingSessionRead = (async () => {
    const sessionFromServer = await requestSession("GET");
    if (!sessionFromServer) {
      inMemorySession = null;
      pendingSessionRead = null;
      return null;
    }

    if (isSessionExpiringSoon(sessionFromServer)) {
      const refreshedSession = await refreshPersistedSupabaseSession();
      inMemorySession = refreshedSession;
      pendingSessionRead = null;
      return refreshedSession;
    }

    inMemorySession = sessionFromServer;
    pendingSessionRead = null;
    return sessionFromServer;
  })();

  return pendingSessionRead;
}
