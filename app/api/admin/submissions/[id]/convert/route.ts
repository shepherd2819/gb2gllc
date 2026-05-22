import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getWorkOS } from "@workos-inc/authkit-nextjs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const { data: session } = await supabaseAdmin
    .from("intake_sessions")
    .select("id, state")
    .eq("id", id)
    .single();

  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const state = session.state as Record<string, Record<string, string>>;
  const contact = state.contact ?? {};
  const about = state.about ?? {};

  const email = contact.email;
  if (!email) return NextResponse.json({ error: "No email on this submission" }, { status: 400 });

  // Upsert client — won't overwrite if they already exist
  const { data: client, error: dbErr } = await supabaseAdmin
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
    .select()
    .single();

  if (dbErr && dbErr.code !== "23505") {
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  // Fetch the existing client if upsert ignored (already exists)
  const { data: existing } = await supabaseAdmin
    .from("clients")
    .select("id, email")
    .eq("email", email)
    .single();

  const clientId = client?.id ?? existing?.id;

  // Send WorkOS invite
  try {
    const workos = getWorkOS();
    await workos.userManagement.sendInvitation({ email });
  } catch (e) {
    console.warn("WorkOS invite failed (may already exist):", e);
  }

  return NextResponse.json({ ok: true, clientId });
}
