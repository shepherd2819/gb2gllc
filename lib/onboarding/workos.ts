// Facade over all WorkOS Phase-B calls (organizations, memberships, Admin
// Portal, Audit Logs). One module so the SDK surface stays contained. Uses
// getWorkOS() from authkit-nextjs (lazy singleton), lazy-imported so module
// load stays test-safe. Signatures confirmed in
// docs/superpowers/research/2026-06-29-workos-phase-b-cheatsheet.md.

async function client() {
  const { getWorkOS } = await import("@workos-inc/authkit-nextjs");
  return getWorkOS();
}

// Idempotent: looks up the org by our client id (stored as WorkOS externalId),
// creating it if absent. Returns the WorkOS org id or null on failure.
export async function findOrCreateOrg(externalId: string, name: string): Promise<string | null> {
  const workos = await client();
  try {
    const existing = await workos.organizations.getOrganizationByExternalId(externalId);
    if (existing?.id) return existing.id;
  } catch {
    // 404 → fall through to create
  }
  try {
    const org = await workos.organizations.createOrganization({ name, externalId });
    return org.id;
  } catch (err) {
    // Possible externalId conflict from a race — re-fetch the winner.
    try {
      const again = await workos.organizations.getOrganizationByExternalId(externalId);
      if (again?.id) return again.id;
    } catch {
      /* ignore */
    }
    console.error("[workos] findOrCreateOrg failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function createMembership(organizationId: string, userId: string, roleSlug: string): Promise<void> {
  const workos = await client();
  await workos.userManagement.createOrganizationMembership({ organizationId, userId, roleSlug });
}

export type AdminPortalIntent = "sso" | "dsync" | "audit_logs" | "log_streams" | "domain_verification";

export async function generateAdminPortalLink(
  organization: string,
  intent: AdminPortalIntent,
  opts?: { returnUrl?: string; successUrl?: string },
): Promise<string | null> {
  const workos = await client();
  const res = await workos.adminPortal.generateLink({
    organization,
    intent: intent as unknown as Parameters<typeof workos.adminPortal.generateLink>[0]["intent"],
    ...(opts?.returnUrl ? { returnUrl: opts.returnUrl } : {}),
    ...(opts?.successUrl ? { successUrl: opts.successUrl } : {}),
  });
  return res?.link ?? null;
}

// Emit an org-scoped WorkOS audit event. `action` must be a registered schema
// (Dashboard) or WorkOS returns 422. Never throws.
export async function emitWorkosAudit(
  orgId: string,
  action: string,
  opts: { actorId?: string; actorType?: string; clientId?: string | null; metadata?: Record<string, string | number | boolean> },
): Promise<void> {
  try {
    const workos = await client();
    await workos.auditLogs.createEvent(orgId, {
      action,
      occurredAt: new Date(),
      actor: { id: opts.actorId ?? "system", type: opts.actorType ?? "system" },
      targets: opts.clientId ? [{ id: opts.clientId, type: "client" }] : [],
      context: { location: "system" },
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
    });
  } catch (err) {
    console.error("[workos] audit createEvent failed:", err instanceof Error ? err.message : err);
  }
}

// WorkOS audit metadata accepts only scalar values, max 50 keys. Strip the rest.
export function scalarsOnly(payload: Record<string, unknown> | undefined | null): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!payload) return out;
  let n = 0;
  for (const [k, v] of Object.entries(payload)) {
    if (n >= 50) break;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
      n++;
    }
  }
  return out;
}
