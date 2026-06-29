import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { getPortalClientId } from "@/lib/portal-auth";
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

  const intent = (req.nextUrl.searchParams.get("intent") ?? "sso") as AdminPortalIntent;
  if (!VALID.includes(intent)) return NextResponse.json({ error: "Invalid intent" }, { status: 400 });

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("workos_org_id")
    .eq("id", clientId)
    .maybeSingle<{ workos_org_id: string | null }>();
  if (!client?.workos_org_id) return NextResponse.redirect(new URL("/onboarding?error=no_org", req.url));

  const link = await generateAdminPortalLink(client.workos_org_id, intent, { returnUrl: `${HOME_URL}/onboarding` });
  if (!link) return NextResponse.redirect(new URL("/onboarding?error=portal_link", req.url));

  return NextResponse.redirect(link);
}
