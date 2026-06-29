// Pure mapping from a WorkOS Directory Sync (SCIM) event to an action on
// client_members. The webhook route resolves the org→client and executes the
// plan; this stays testable. Payloads are snake_case DirectoryUserResponse.

import type { MemberRole } from "./types";

const ALLOWED_ROLES: MemberRole[] = ["owner", "admin", "member", "billing", "read_only"];

export type ScimPlan =
  | { action: "upsert"; organizationId: string; email: string; role: MemberRole }
  | { action: "delete"; organizationId: string; email: string }
  | { action: "ignore"; reason: string };

type DirectoryUser = {
  organization_id?: string | null;
  email?: string | null;
  state?: string;
  role?: { slug?: string } | string | null;
};

export function normalizeRole(role: unknown): MemberRole {
  const slug =
    typeof role === "string"
      ? role
      : role && typeof role === "object" && "slug" in role && typeof (role as { slug?: unknown }).slug === "string"
        ? (role as { slug: string }).slug
        : null;
  return slug && (ALLOWED_ROLES as string[]).includes(slug) ? (slug as MemberRole) : "member";
}

export function planMemberChange(eventName: string, data: unknown): ScimPlan {
  const d = (data ?? {}) as DirectoryUser;

  switch (eventName) {
    case "dsync.user.created":
    case "dsync.user.updated": {
      if (!d.organization_id) return { action: "ignore", reason: "no organization_id" };
      if (!d.email) return { action: "ignore", reason: "no email" };
      if (d.state === "inactive") return { action: "delete", organizationId: d.organization_id, email: d.email };
      return { action: "upsert", organizationId: d.organization_id, email: d.email, role: normalizeRole(d.role) };
    }
    case "dsync.user.deleted": {
      if (!d.organization_id || !d.email) return { action: "ignore", reason: "missing org/email" };
      return { action: "delete", organizationId: d.organization_id, email: d.email };
    }
    default:
      // group + connection lifecycle events are logged but not mapped to members in v1
      return { action: "ignore", reason: `unhandled ${eventName}` };
  }
}
