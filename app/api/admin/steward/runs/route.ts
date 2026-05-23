import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runStewardAgent } from "@/lib/steward/run-agent";
import { requireAdmin } from "@/lib/admin-auth";

// POST { assignmentId, inputText? } — trigger a manual run
export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { assignmentId, inputText } = await req.json();
  if (!assignmentId) return NextResponse.json({ error: "assignmentId required" }, { status: 400 });

  try {
    const result = await runStewardAgent({ assignmentId, trigger: "manual", inputText });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// GET ?assignmentId=X&limit=20 — list recent runs
export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const assignmentId = req.nextUrl.searchParams.get("assignmentId");
  const clientId = req.nextUrl.searchParams.get("clientId");
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);

  let query = supabaseAdmin
    .from("steward_runs")
    .select("id, assignment_id, trigger, status, summary, tokens_used, started_at, completed_at, error")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (assignmentId) query = query.eq("assignment_id", assignmentId);
  if (clientId) query = query.eq("client_id", clientId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
