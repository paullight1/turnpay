// This capability must come from the authenticated backend bootstrap response.
// Never infer privileges from an email string, a capability flag, or Supabase
// user_metadata in UI. Admin route access is reserved for an explicit role.
export function hasAdminAccess(
  user?: { role?: string; canAccessAdmin?: boolean } | null,
): boolean {
  return user?.role === "ADMIN";
}
