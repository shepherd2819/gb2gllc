import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ sessionId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { sessionId } = await params;

  const { data, error } = await supabaseAdmin
    .from("intake_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ error: "Session expired" }, { status: 410 });
  }

  return NextResponse.json({ sessionId, state: data.state, submittedAt: data.submitted_at });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { sessionId } = await params;

  const patch = await req.json().catch(() => null);
  if (!patch || typeof patch !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Fetch existing state, merge at the top-level key level
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("intake_sessions")
    .select("state, submitted_at, expires_at")
    .eq("id", sessionId)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (existing.submitted_at) {
    return NextResponse.json({ error: "Session already submitted" }, { status: 409 });
  }
  if (new Date(existing.expires_at) < new Date()) {
    return NextResponse.json({ error: "Session expired" }, { status: 410 });
  }

  const merged = { ...(existing.state as Record<string, unknown>), ...patch };

  const { error: updateErr } = await supabaseAdmin
    .from("intake_sessions")
    .update({ state: merged })
    .eq("id", sessionId);

  if (updateErr) throw updateErr;

  return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
}
