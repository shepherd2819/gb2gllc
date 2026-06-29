import { supabaseAdmin } from "@/lib/supabase";

/**
 * Resolve the client_id for a signed-in portal user.
 * Owner: clients.workos_user_id = user.id
 * Teammate: client_members.workos_user_id = user.id
 *
 * Does NOT do first-sign-in backfill — that's the layout's job. By the time
 * a page calls this, the layout has already linked the WorkOS id to a row.
 *
 * Returns null if the user is not associated with any client (caller should
 * redirect to /auth/no-account).
 */
export async function getPortalClientId(workosUserId: string): Promise<string | null> {
  const { data: owner } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("workos_user_id", workosUserId)
    .maybeSingle();
  if (owner?.id) return owner.id;

  const { data: member } = await supabaseAdmin
    .from("client_members")
    .select("client_id")
    .eq("workos_user_id", workosUserId)
    .maybeSingle();
  return member?.client_id ?? null;
}

/**
 * True if the user is the *owner* of this client (the one in clients.workos_user_id),
 * not just a teammate. Used to gate destructive actions like inviting/removing teammates.
 */
export async function isClientOwner(workosUserId: string, clientId: string): Promise<boolean> {
  const { data: owner } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("workos_user_id", workosUserId)
    .eq("id", clientId)
    .maybeSingle();
  return !!owner;
}

/**
 * RBAC role + permission context from the WorkOS AuthKit session JWT (no DB).
 * role/permissions are undefined unless the session is in an org context.
 */
export async function getSessionContext(): Promise<{
  role?: string;
  roles?: string[];
  permissions?: string[];
  organizationId?: string;
}> {
  const { withAuth } = await import("@workos-inc/authkit-nextjs");
  const session = (await withAuth()) as {
    role?: string;
    roles?: string[];
    permissions?: string[];
    organizationId?: string;
  };
  return {
    role: session.role,
    roles: session.roles,
    permissions: session.permissions,
    organizationId: session.organizationId,
  };
}

/** True if the current session carries the given WorkOS permission slug. */
export async function hasPermission(permission: string): Promise<boolean> {
  const { permissions } = await getSessionContext();
  return !!permissions?.includes(permission);
}

/**
 * The caller's role for a client: 'owner' if they own the client row, else the
 * client_members.role (member/admin/billing/read_only), else null.
 */
export async function getMemberRole(workosUserId: string, clientId: string): Promise<string | null> {
  if (await isClientOwner(workosUserId, clientId)) return "owner";
  const { data: member } = await supabaseAdmin
    .from("client_members")
    .select("role")
    .eq("workos_user_id", workosUserId)
    .eq("client_id", clientId)
    .maybeSingle<{ role: string | null }>();
  return member?.role ?? null;
}
