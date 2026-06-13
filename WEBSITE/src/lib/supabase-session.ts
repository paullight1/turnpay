"use client";

import type { Session } from "@supabase/supabase-js";

const SESSION_COOKIE_NAME = "supabase.auth.token";
const SESSION_STORAGE_KEY = "trustpay.auth.session";
const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const CHUNK_COUNT = 8;

type PersistedSession = Session & {
  authMode?: "supabase" | "local";
};

let inMemorySession: PersistedSession | null = null;

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function setCookie(name: string, value: string, maxAgeSeconds: number) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

function clearSessionChunks() {
  clearCookie(SESSION_COOKIE_NAME);

  for (let index = 0; index < CHUNK_COUNT; index += 1) {
    clearCookie(`${SESSION_COOKIE_NAME}.${index}`);
  }
}

function writeSessionStorage(session: PersistedSession) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage failures and fall back to cookies + memory.
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

async function syncSessionCookieViaForm(session: PersistedSession) {
  if (typeof document === "undefined") {
    return;
  }

  const host = document.body || document.documentElement;
  if (!host) {
    return;
  }

  await new Promise<void>((resolve) => {
    const iframeName = `trustpay-auth-session-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const iframe = document.createElement("iframe");
    const form = document.createElement("form");
    const input = document.createElement("input");

    let timeoutId = 0;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      form.remove();
      iframe.remove();
      resolve();
    };

    iframe.name = iframeName;
    iframe.style.display = "none";
    iframe.addEventListener("load", cleanup, { once: true });

    form.method = "POST";
    form.action = "/api/auth/session";
    form.target = iframeName;
    form.style.display = "none";

    input.type = "hidden";
    input.name = "session";
    input.value = JSON.stringify({ session });
    form.appendChild(input);

    host.appendChild(iframe);
    host.appendChild(form);

    timeoutId = window.setTimeout(cleanup, 1500);

    try {
      form.submit();
    } catch {
      cleanup();
    }
  });
}

function encodeSession(session: PersistedSession) {
  return `base64-${base64UrlEncode(JSON.stringify(session))}`;
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

function decodeSession(value: string | null): PersistedSession | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = value.startsWith("base64-")
      ? JSON.parse(
          new TextDecoder().decode(
            Uint8Array.from(atob(value.slice("base64-".length)), (char) =>
              char.charCodeAt(0),
            ),
          ),
        )
      : JSON.parse(value);

    return isPersistedSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readCookieValue(name: string) {
  if (typeof document === "undefined") {
    return null;
  }

  const prefix = `${name}=`;
  const cookies = document.cookie.split("; ");
  const match = cookies.find((entry) => entry.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function readSessionFromCookies(): PersistedSession | null {
  const directCookie = decodeSession(readCookieValue(SESSION_COOKIE_NAME));
  if (directCookie) {
    return directCookie;
  }

  for (let index = 0; index < CHUNK_COUNT; index += 1) {
    const chunkCookie = decodeSession(
      readCookieValue(`${SESSION_COOKIE_NAME}.${index}`),
    );
    if (chunkCookie) {
      return chunkCookie;
    }
  }

  return null;
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
  if (typeof document === "undefined") {
    return;
  }

  clearSessionChunks();
  setCookie(SESSION_COOKIE_NAME, encodeSession(persistedSession), SESSION_COOKIE_MAX_AGE_SECONDS);
  writeSessionStorage(persistedSession);

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
      // Ignore route failures and keep the client-side fallback in place.
    }
  }

  await syncSessionCookieViaForm(persistedSession);
}

export async function clearSupabaseSession() {
  inMemorySession = null;
  if (typeof document === "undefined") {
    return;
  }

  clearSessionChunks();
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

  const cookieSession = readSessionFromCookies();
  if (cookieSession) {
    inMemorySession = cookieSession;
    return cookieSession;
  }

  return null;
}
