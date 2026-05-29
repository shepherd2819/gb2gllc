import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";

// PATCH: update draft fields, or change status (acknowledged/dismissed)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.draft_subject === "string") update.draft_subject = body.draft_subject;
  if (typeof body.draft_body === "string")    update.draft_body    = body.draft_body;
  if (typeof body.draft_to_email === "string") update.draft_to_email = body.draft_to_email;
  if (body.status === "acknowledged" || body.status === "dismissed" || body.status === "classified") update.status = body.status;

  const { error } = await supabaseAdmin.from("nora_events").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
