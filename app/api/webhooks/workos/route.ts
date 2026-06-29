import { NextResponse } from "next/server";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { SignatureVerificationException } from "@workos-inc/node";
import { supabaseAdmin } from "@/lib/supabase";
import { logEvent } from "@/lib/logger";
import { planMemberChange } from "@/lib/onboarding/scim";

export const dynamic = "force-dynamic";

// WorkOS Directory Sync (SCIM) webhook. Verifies the signature, then provisions
// / deprovisions client_members from dsync.user.* events. Machine-to-machine —
// not behind AuthKit (/* api/* is excluded from proxy.ts matcher). Per-endpoint
// secret in WORKOS_WEBHOOK_SECRET (distinct from WORKOS_API_KEY).
export async function POST(req: Request) {
  const raw = await req.text(); // raw body required for signature verification
  const sigHeader = req.headers.get("workos-signature") ?? "";
  const secret = process.env.WORKOS_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "WORKOS_WEBHOOK_SECRET not set" }, { status: 503 });

  let event;
  try {
    event = await getWorkOS().webhooks.constructEvent({ payload: raw, sigHeader, secret });
  } catch (err) {
    if (err instanceof SignatureVerificationException) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    throw err;
  }

  const plan = planMemberChange(event.event, event.data);
  if (plan.action === "ignore") return NextResponse.json({ received: true, ignored: plan.reason });

  // Resolve the GB2G client from the WorkOS org id.
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("workos_org_id", plan.organizationId)
    .maybeSingle<{ id: string }>();
  if (!client) return NextResponse.json({ received: true, note: "no client for org" });

  if (plan.action === "upsert") {
    const { data: existing } = await supabaseAdmin
      .from("client_members")
      .select("id")
      .eq("client_id", client.id)
      .ilike("email", plan.email)
      .maybeSingle<{ id: string }>();
    if (existing) {
      await supabaseAdmin.from("client_members").update({ role: plan.role }).eq("id", existing.id);
    } else {
      await supabaseAdmin.from("client_members").insert({ client_id: client.id, email: plan.email, role: plan.role });
    }
  } else if (plan.action === "delete") {
    // Deprovision: remove portal access for the directory-removed user.
    await supabaseAdmin.from("client_members").delete().eq("client_id", client.id).ilike("email", plan.email);
  }

  await logEvent({
    clientId: client.id,
    category: "onboarding",
    message: `scim ${event.event}`,
    metadata: { email: plan.email, action: plan.action },
  });

  return NextResponse.json({ received: true });
}
