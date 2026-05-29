import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status === "active" || body.status === "paused") update.status = body.status;
  if (typeof body.label === "string" && body.label.trim()) update.label = body.label.trim();

  const { error } = await supabaseAdmin.from("nora_accounts").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin.from("nora_accounts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
