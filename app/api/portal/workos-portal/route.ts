import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { getPortalClientId, getMemberRole } from "@/lib/portal-auth";
import { generateAdminPortalLink, type AdminPortalIntent } from "@/lib/onboarding/workos";

export const dynamic = "force-dynamic";

const HOME_URL = process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com";
const VALID: AdminPortalIntent[] = ["sso", "dsync", "audit_logs"];

// GET /api/portal/workos-portal?intent=sso|dsync|audit_logs
// Generates a fresh WorkOS Admin Portal link (5-min expiry — never stored) and
// redirects the client's IT admin straight into it. Used as a plain <a href>.
export async function GET(req: NextRequest) {
  const { user } = await withAuth();
  if (!user) return NextResponse.redirect(new URL("/auth/signin?next=/onboarding", req.url));

  const clientId = await getPortalClientId(user.id);
  if (!clientId) return NextResponse.redirect(new URL("/auth/no-account", req.url));

  // Authorization: the WorkOS Admin Portal reconfigures how the whole org
  // authenticates (SSO / directory sync / audit logs). Restrict it to the
  // account owner or an admin teammate — a plain member/billing/read_only
  // teammate must never reach it. getMemberRole returns "owner" for the client
  // owner, else the client_members.role, else null.
  const role = await getMemberRole(user.id, clientId);
  if (role !== "owner" && role !== "admin") {
    return NextResponse.redirect(new URL("/onboarding?error=forbidden", req.url));
  }

  const intent = (req.nextUrl.searchParams.get("intent") ?? "sso") as AdminPortalIntent;
  if (!VALID.includes(intent)) return NextResponse.json({ error: "Invalid intent" }, { status: 400 });

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("workos_org_id")
    .eq("id", clientId)
    .maybeSingle<{ workos_org_id: string | null }>();
  if (!client?.workos_org_id) return NextResponse.redirect(new URL("/onboarding?error=no_org", req.url));

  // Enterprise identity setup (SSO/SCIM) isn't offered on the self-serve tier.
  // Block only an explicit self_serve tier — a null/absent journey does not
  // falsely deny an owner whose journey tier hasn't been set yet.
  const { data: journey } = await supabaseAdmin
    .from("onboarding_journeys")
    .select("tier")
    .eq("client_id", clientId)
    .maybeSingle<{ tier: string | null }>();
  if (journey?.tier === "self_serve") {
    return NextResponse.redirect(new URL("/onboarding?error=tier", req.url));
  }

  const link = await generateAdminPortalLink(client.workos_org_id, intent, { returnUrl: `${HOME_URL}/onboarding` });
  if (!link) return NextResponse.redirect(new URL("/onboarding?error=portal_link", req.url));

  return NextResponse.redirect(link);
}
