import { createBrowserClient } from "@supabase/ssr";
import { createClient as createJsClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabasePublishableKey,
);

export function createClient() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  return createBrowserClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: true,
      persistSession: false,
    },
  });
}

/**
 * Password recovery links are opened from an email client, which may hand
 * them to a different browser or device than the one that requested them.
 * Use the client-only implicit flow for this isolated recovery handoff so it
 * does not depend on a PKCE verifier stored in the requesting browser.
 */
export function createRecoveryClient() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  return createJsClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      flowType: "implicit",
      autoRefreshToken: false,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });
}
