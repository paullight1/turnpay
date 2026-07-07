"use client";

import type { Session } from "@supabase/supabase-js";

const SESSION_COOKIE_NAME = "supabase.auth.token";
const SESSION_STORAGE_KEY = "trustpay.auth.session";
const CHUNK_COUNT = 8;

type PersistedSession = Session & {
  authMode?: "supabase" | "local";
};

// Kept only within the running JS context (not persisted). Holds the full
// session, including the refresh token, so in-tab refresh works. It is cleared
// on reload/navigation, which is acceptable — persistent copies are the XSS
// risk, and those are minimized below.
let inMemorySession: PersistedSession | null = null;

function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

// Purge any legacy JS-readable session cookies. We no longer WRITE these: the
// authoritative server-side copy is an HttpOnly, Secure cookie set by
// /api/auth/session, which JavaScript cannot read (mitigating token theft via
// XSS).
function clearLegacySessionChunks() {
  clearCookie(SESSION_COOKIE_NAME);

  for (let index = 0; index < CHUNK_COUNT; index += 1) {
    clearCookie(`${SESSION_COOKIE_NAME}.${index}`);
  }
}

// The refresh token is the long-lived, high-value secret; it is never mirrored
// into JS-readable storage. Only a short-lived access-token copy is retained in
// localStorage so authenticated API calls survive a reload in backend "local"
// auth mode (Supabase mode recovers from Supabase's own client storage).
//
// TODO(launch): even the access token in localStorage is XSS-exposed. Move
// backend "local" auth-mode session persistence and refresh fully server-side
// (HttpOnly cookie + a server refresh endpoint) so no token is JS-readable.
function toMinimizedSession(session: PersistedSession): PersistedSession {
  return { ...session, refresh_token: "" };
}

function writeSessionStorage(session: PersistedSession) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify(toMinimizedSession(session)),
    );
  } catch {
    // Ignore storage failures and fall back to the in-memory session.
  }
}

function clearSessionStorage() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures when clearing stale state.
  }
}

function isPersistedSession(candidate: unknown): candidate is PersistedSession {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "access_token" in candidate &&
    "user" in candidate
  );
}

function readSessionFromStorage(): PersistedSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as unknown;
    return isPersistedSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function persistSupabaseSession(session: Session) {
  const persistedSession = session as PersistedSession;

  inMemorySession = persistedSession;
  if (typeof window === "undefined") {
    return;
  }

  // Clean up any legacy JS-readable full-session cookies from older builds.
  clearLegacySessionChunks();
  writeSessionStorage(persistedSession);

  // Set the authoritative HttpOnly session cookie via a same-origin JSON POST.
  // The server validates the access token before minting the cookie.
  if (typeof fetch === "function") {
    try {
      await fetch("/api/auth/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ session: persistedSession }),
      });
    } catch {
      // Ignore route failures and keep the in-memory session in place.
    }
  }
}

export async function clearSupabaseSession() {
  inMemorySession = null;
  if (typeof window === "undefined") {
    return;
  }

  clearLegacySessionChunks();
  clearSessionStorage();

  if (typeof fetch === "function") {
    try {
      await fetch("/api/auth/session", {
        method: "DELETE",
      });
    } catch {
      // Ignore route failures when clearing stale state.
    }
  }
}

export function readPersistedSupabaseSession() {
  if (inMemorySession) {
    return inMemorySession;
  }

  const storedSession = readSessionFromStorage();
  if (storedSession) {
    inMemorySession = storedSession;
    return storedSession;
  }

  return null;
}
