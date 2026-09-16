export const DEFAULT_API_ORIGIN = "https://api.trustpayhq.com";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type ApiOriginOptions = {
  fallback?: string;
  production?: boolean;
};

function isLoopbackHttpUrl(url: URL) {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Resolve the API as an origin before a request can carry credentials.
 * Local HTTP is allowed for local development and production-mode browser
 * tests; every non-loopback production origin must use HTTPS.
 */
export function resolveApiOrigin(
  configured = process.env.NEXT_PUBLIC_API_URL,
  options: ApiOriginOptions = {},
) {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const fallback =
    options.fallback ??
    (production ? DEFAULT_API_ORIGIN : "http://localhost:3000");

  if (!configured?.trim()) {
    return fallback;
  }

  let url: URL;
  try {
    url = new URL(configured.trim());
  } catch {
    throw new Error("NEXT_PUBLIC_API_URL must be a valid absolute URL");
  }

  const localHttp = isLoopbackHttpUrl(url);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error(
      production
        ? "NEXT_PUBLIC_API_URL must use HTTPS in production"
        : "NEXT_PUBLIC_API_URL must use HTTPS or a loopback HTTP origin",
    );
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "NEXT_PUBLIC_API_URL must be an origin without credentials, query, or hash",
    );
  }

  return url.origin;
}
