import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const LOCAL_SESSION_COOKIE_NAME = "supabase.auth.token";

const PROTECTED_ROUTES = ["/dashboard"];
const ADMIN_ROUTES = ["/admin"];
const AUTH_ROUTES = ["/login", "/register"];

type LocalSessionCookie = {
  access_token: string;
};

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(normalized + padding);
}

function readLocalSessionCookie(request: NextRequest) {
  const cookieValue = request.cookies.get(LOCAL_SESSION_COOKIE_NAME)?.value;

  if (!cookieValue?.startsWith("base64-")) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      decodeBase64Url(cookieValue.slice("base64-".length)),
    ) as Partial<LocalSessionCookie>;

    if (!parsed.access_token) {
      return null;
    }

    return parsed as LocalSessionCookie;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();

  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  const isAdmin = ADMIN_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  const isAuthRoute = AUTH_ROUTES.includes(pathname);

  if (!supabaseUrl || !supabaseAnonKey) {
    if (isProtected || isAdmin) {
      const url = new URL("/login", request.url);
      url.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(url);
    }

    return response;
  }

  // Create Supabase client for server-side session check
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data: { session } } = await supabase.auth.getSession();
  const localSession = readLocalSessionCookie(request);

  if (isProtected && !session && !localSession?.access_token) {
    const url = new URL("/login", request.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  if (isAdmin) {
    if (!session && !localSession?.access_token) {
      const url = new URL("/login", request.url);
      url.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(url);
    }

    // Admin authorization is enforced by the backend. User metadata is not
    // trusted here because Supabase user_metadata is user-editable.
  }

  if (isAuthRoute && (session || localSession?.access_token)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/login", "/register"],
};
