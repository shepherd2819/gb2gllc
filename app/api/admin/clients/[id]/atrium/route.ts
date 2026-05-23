import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { label, note } = await req.json();

  const { data: existing } = await supabaseAdmin
    .from("atrium_progress").select("stage").eq("client_id", id).order("stage", { ascending: false }).limit(1);
  const nextStage = (existing?.[0]?.stage ?? 0) + 1;

  const { data, error } = await supabaseAdmin
    .from("atrium_progress")
    .insert({ client_id: id, stage: nextStage, label, note: note || null, completed: false })
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stage: data });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  await params;
  const { id: stageId, completed } = await req.json();

  await supabaseAdmin
    .from("atrium_progress")
    .update({ completed, completed_at: completed ? new Date().toISOString() : null })
    .eq("id", stageId);

  return NextResponse.json({ ok: true });
}
