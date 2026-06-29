// Provisioning side-effects, all idempotent. Phase A: activate a product, send
// the WorkOS portal invite. Phase B adds: ensure a WorkOS Organization
// (clients.workos_org_id), SSO/SCIM config, RBAC role seeding.

export async function activateProduct(clientId: string, product: string): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data: existing } = await supabaseAdmin
    .from("client_products")
    .select("id")
    .eq("client_id", clientId)
    .eq("product", product)
    .maybeSingle<{ id: string }>();
  if (existing) {
    await supabaseAdmin.from("client_products").update({ active: true }).eq("id", existing.id);
  } else {
    await supabaseAdmin.from("client_products").insert({ client_id: clientId, product, active: true });
  }
}

export async function sendPortalInvite(email: string, opts?: { organizationId?: string; roleSlug?: string }): Promise<void> {
  try {
    const { getWorkOS } = await import("@workos-inc/authkit-nextjs");
    await getWorkOS().userManagement.sendInvitation({
      email,
      ...(opts?.organizationId ? { organizationId: opts.organizationId } : {}),
      // roleSlug only applies when an org is set
      ...(opts?.organizationId && opts?.roleSlug ? { roleSlug: opts.roleSlug } : {}),
    });
  } catch (err) {
    // Invite may already exist — non-fatal (matches the convert route's posture).
    console.warn("[onboarding/provision] WorkOS invite failed (may already exist):", err instanceof Error ? err.message : err);
  }
}

// Ensure the client's WorkOS Organization exists (the anchor for SSO/SCIM/Admin
// Portal/Audit Logs) and persist clients.workos_org_id. Idempotent; never throws
// (returns null on failure so the onboarding pipeline still completes — a
// backfill can fix it later). Our client id is stored as the org's externalId.
export async function ensureWorkosOrg(clientId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { findOrCreateOrg, createMembership } = await import("./workos");

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("workos_org_id, company, name, email, workos_user_id")
    .eq("id", clientId)
    .maybeSingle<{ workos_org_id: string | null; company: string | null; name: string | null; email: string | null; workos_user_id: string | null }>();
  if (!client) return null;
  if (client.workos_org_id) return client.workos_org_id;

  const name = client.company || client.name || client.email || `Client ${clientId.slice(0, 8)}`;
  const orgId = await findOrCreateOrg(clientId, name);
  if (!orgId) return null;

  await supabaseAdmin.from("clients").update({ workos_org_id: orgId }).eq("id", clientId);

  // If the owner has already linked their WorkOS user, attach them as admin now.
  if (client.workos_user_id) {
    try {
      await createMembership(orgId, client.workos_user_id, "admin");
    } catch (err) {
      console.warn("[onboarding/provision] org membership failed:", err instanceof Error ? err.message : err);
    }
  }
  return orgId;
}
