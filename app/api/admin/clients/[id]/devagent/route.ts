// app/api/admin/clients/[id]/devagent/route.ts
//
// GET  → current assignment + recent runs
// PUT  → upsert assignment (mission, trigger_categories, budget_overrides, active)
// POST → manual dispatch (taskText) — emits the same Inngest event auto-trigger uses

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { enqueueManualRun } from "@/lib/devagent/platform/enqueue";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id: clientId } = await params;

  const [{ data: assignment }, { data: runs }] = await Promise.all([
    supabaseAdmin
      .from("client_devagent_assignments")
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle(),
    supabaseAdmin
      .from("devagent_runs")
      .select("id, trigger, triggering_ticket_id, task_text, status, ship, tokens_used, cost_usd, error, started_at, completed_at")
      .eq("client_id", clientId)
      .order("started_at", { ascending: false })
      .limit(50),
  ]);

  return NextResponse.json({ assignment: assignment ?? null, runs: runs ?? [] });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id: clientId } = await params;
  const body = await req.json();

  const update: Record<string, unknown> = {
    client_id:  clientId,
    updated_at: new Date().toISOString(),
  };
  if (typeof body.mission === "string") update.mission = body.mission;
  if (Array.isArray(body.trigger_categories)) update.trigger_categories = body.trigger_categories;
  if (body.budget_overrides !== undefined) update.budget_overrides = body.budget_overrides;
  if (typeof body.active === "boolean") update.active = body.active;

  const { data, error } = await supabaseAdmin
    .from("client_devagent_assignments")
    .upsert(update, { onConflict: "client_id" })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assignment: data });
}

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id: clientId } = await params;
  const { taskText } = await req.json();
  if (typeof taskText !== "string" || taskText.trim().length === 0) {
    return NextResponse.json({ error: "taskText required" }, { status: 400 });
  }

  const { eventId } = await enqueueManualRun({ clientId, taskText: taskText.slice(0, 5000) });
  return NextResponse.json({ ok: true, eventId });
}
