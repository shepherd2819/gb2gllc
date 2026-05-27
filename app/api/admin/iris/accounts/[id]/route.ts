import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";

// PATCH: update status (active/paused). DELETE: disconnect.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const status: unknown = body.status;
  if (status !== "active" && status !== "paused") {
    return NextResponse.json({ error: "status must be 'active' or 'paused'" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("iris_inbox_accounts")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  // ON DELETE CASCADE wipes messages + settings.
  const { error } = await supabaseAdmin.from("iris_inbox_accounts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
