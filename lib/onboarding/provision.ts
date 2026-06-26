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

export async function sendPortalInvite(email: string): Promise<void> {
  try {
    const { getWorkOS } = await import("@workos-inc/authkit-nextjs");
    await getWorkOS().userManagement.sendInvitation({ email });
  } catch (err) {
    // Invite may already exist — non-fatal (matches the convert route's posture).
    console.warn("[onboarding/provision] WorkOS invite failed (may already exist):", err instanceof Error ? err.message : err);
  }
}

// Phase B placeholder — create/ensure the client's WorkOS Organization and store
// clients.workos_org_id. Org-dependent features (SSO, SCIM, Admin Portal, Audit
// Logs) build on this. Implemented in the enterprise-identity phase.
export async function ensureWorkosOrg(_clientId: string): Promise<string | null> {
  return null;
}
