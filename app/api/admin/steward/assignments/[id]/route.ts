import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = await req.json();

  const updates: Record<string, unknown> = {};
  if (body.mission   !== undefined) updates.mission   = body.mission.trim();
  if (body.active    !== undefined) updates.active    = body.active;
  if (body.schedule  !== undefined) updates.schedule  = body.schedule?.trim() || null;

  const { data, error } = await supabaseAdmin
    .from("client_steward_assignments")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { error } = await supabaseAdmin
    .from("client_steward_assignments")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
