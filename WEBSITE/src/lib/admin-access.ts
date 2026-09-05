// This capability must come from the authenticated backend bootstrap response.
// Never infer privileges from an email string or Supabase user_metadata in UI.
export function hasAdminAccess(user?: { role?: string; canAccessAdmin?: boolean } | null): boolean {
  return user?.role === "ADMIN" || user?.canAccessAdmin === true;
}
