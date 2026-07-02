import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { requireAdmin } from "@/lib/admin-auth";
import { HERALD_PRODUCT, heraldAnswers } from "@/lib/intake/herald";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const { data: session } = await supabaseAdmin
    .from("intake_sessions")
    .select("id, state, intended_product")
    .eq("id", id)
    .single();

  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const state = session.state as Record<string, Record<string, string>>;
  const contact = state.contact ?? {};

  const email = contact.email;
  if (!email) return NextResponse.json({ error: "No email on this submission" }, { status: 400 });

  // Upsert client — won't overwrite if they already exist
  const { data: inserted, error: dbErr } = await supabaseAdmin
    .from("clients")
    .upsert(
      {
        email,
        name: contact.name || null,
        company: contact.company || null,
        intake_session_id: id,
      },
      { onConflict: "email", ignoreDuplicates: true }
    )
    .select("id");

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  // ignoreDuplicates returns 0 rows on conflict — fall back to fetching the existing record
  let clientId: string | null = inserted?.[0]?.id ?? null;
  if (!clientId) {
    const { data: existing } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("email", email)
      .single();
    clientId = existing?.id ?? null;
  }

  if (!clientId) return NextResponse.json({ error: "Could not find or create client" }, { status: 500 });

  // Herald-link parity: manual convert enables the product + maps the agent
  // name exactly like the hands-off submit path.
  let heraldEnabled = false;
  if (session.intended_product === HERALD_PRODUCT) {
    const { error: prodErr } = await supabaseAdmin
      .from("client_products")
      .upsert(
        { client_id: clientId, product: HERALD_PRODUCT, active: true },
        { onConflict: "client_id,product" }
      );
    if (prodErr) console.error("[convert] client_products upsert failed:", prodErr);
    heraldEnabled = !prodErr;

    const agentName = heraldAnswers(state).voice.agentName.trim();
    if (agentName) {
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("chatbot_agent_name")
        .eq("id", clientId)
        .single();
      if (client && !client.chatbot_agent_name) {
        await supabaseAdmin
          .from("clients")
          .update({ chatbot_agent_name: agentName })
          .eq("id", clientId);
      }
    }
  }

  // Send WorkOS invite
  try {
    const workos = getWorkOS();
    await workos.userManagement.sendInvitation({ email });
  } catch (e) {
    console.warn("WorkOS invite failed (may already exist):", e);
  }

  return NextResponse.json({ ok: true, clientId, heraldEnabled });
}
