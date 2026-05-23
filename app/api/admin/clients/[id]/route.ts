import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, string | boolean | null> = {};
  if ("name" in body) updates.name = body.name || null;
  if ("email" in body) updates.email = body.email;
  if ("company" in body) updates.company = body.company || null;
  if ("chatbot_bot_id" in body) updates.chatbot_bot_id = body.chatbot_bot_id?.trim() || null;
  if ("herald_digest_enabled" in body) updates.herald_digest_enabled = !!body.herald_digest_enabled;

  const { error } = await supabaseAdmin.from("clients").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
