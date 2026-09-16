"use client";

import type { Session } from "@supabase/supabase-js";

const SESSION_COOKIE_NAME = "supabase.auth.token";
const CSRF_COOKIE_NAME = "trustpay.csrf-token";
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

function readCookie(name: string) {
  const prefix = `${name}=`;
  const entry = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));

  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
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
  const payload = (await response
    .json()
    .catch(() => null)) as SessionRouteResponse | null;

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

  if (typeof window === "undefined") {
    inMemorySession = persistedSession;
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
        if (response.status === 403) {
          throw new Error('Website access is for staff only. Use the TrustPay mobile app for your customer account.');
        }
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
      inMemorySession = confirmedSession;
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

export class SessionCleanupError extends Error {
  constructor(message = "Unable to securely clear the website session") {
    super(message);
    this.name = "SessionCleanupError";
  }
}

async function getCsrfToken(forceRefresh = false) {
  if (!forceRefresh) {
    const cookieToken = readCookie(CSRF_COOKIE_NAME);
    if (cookieToken) {
      inMemoryCsrfToken = cookieToken;
      return cookieToken;
    }

    if (inMemoryCsrfToken) {
      return inMemoryCsrfToken;
    }
  }

  const response = await fetch("/api/auth/session", {
    method: "GET",
    cache: "no-store",
  });

  if (response.status === 401) {
    // The route clears an expired or unverifiable session itself.
    inMemoryCsrfToken = null;
    return null;
  }

  if (!response.ok) {
    throw new SessionCleanupError("Unable to recover the secure sign out token");
  }

  await parseSessionRouteResponse(response);
  const token = inMemoryCsrfToken || readCookie(CSRF_COOKIE_NAME);
  if (!token) {
    throw new SessionCleanupError("Unable to recover the secure sign out token");
  }

  inMemoryCsrfToken = token;
  return token;
}

async function deleteServerSession() {
  let csrfToken = await getCsrfToken();
  if (!csrfToken) return;

  const requestDelete = (token: string) =>
    fetch("/api/auth/session", {
      method: "DELETE",
      cache: "no-store",
      headers: {
        "x-csrf-token": token,
      },
    });

  let response = await requestDelete(csrfToken);
  if (response.status === 403) {
    // A tab can hold a stale in-memory token after another tab refreshed the
    // CSRF cookie. Recover a fresh pair once, then retry the deletion.
    inMemoryCsrfToken = null;
    csrfToken = await getCsrfToken(true);
    if (!csrfToken) return;
    response = await requestDelete(csrfToken);
  }

  if (!response.ok) {
    throw new SessionCleanupError("Unable to complete secure sign out");
  }
}

async function verifyServerSessionCleared() {
  const response = await fetch("/api/auth/session", {
    method: "GET",
    cache: "no-store",
  });

  if (response.status === 401) return;
  if (!response.ok) {
    throw new SessionCleanupError("Unable to verify secure sign out");
  }

  const session = await parseSessionRouteResponse(response);
  if (session) {
    throw new SessionCleanupError("Unable to verify secure sign out");
  }
}

export async function clearSupabaseSession() {
  if (typeof window === "undefined") {
    inMemorySession = null;
    inMemoryCsrfToken = null;
    return;
  }

  // Clear legacy client-visible state immediately, but keep the active
  // in-memory session until the HttpOnly cookie has been deleted and verified.
  clearLegacySessionChunks();

  if (typeof fetch === "function") {
    try {
      await deleteServerSession();
      await verifyServerSessionCleared();
    } catch (error) {
      if (error instanceof SessionCleanupError) throw error;
      throw new SessionCleanupError();
    }
  }

  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures when clearing stale state.
  }

  clearCookie(CSRF_COOKIE_NAME);
  inMemorySession = null;
  inMemoryCsrfToken = null;
  pendingSessionRead = null;
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
