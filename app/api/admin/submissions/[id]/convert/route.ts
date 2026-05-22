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

  // Send WorkOS invite
  try {
    const workos = getWorkOS();
    const homeUrl = process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com";
    await workos.userManagement.sendInvitation({ email, redirectUri: `${homeUrl}/auth/callback` });
  } catch (e) {
    console.warn("WorkOS invite failed (may already exist):", e);
  }

  return NextResponse.json({ ok: true, clientId });
}
