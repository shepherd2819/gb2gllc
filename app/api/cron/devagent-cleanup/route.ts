import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { logEvent } from "@/lib/logger";

const STALE_AFTER_MS = 30 * 60_000; // 30 minutes

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const { data: stale, error: selectErr } = await supabaseAdmin
    .from("devagent_runs")
    .select("id, client_id, status, started_at")
    .in("status", ["queued", "running"])
    .lt("started_at", cutoff);

  if (selectErr) {
    await logEvent({
      category: "system",
      level: "error",
      message: `devagent-cleanup: select failed: ${selectErr.message}`,
    });
    return NextResponse.json({ error: selectErr.message }, { status: 500 });
  }

  const ids = (stale ?? []).map((r) => r.id);
  if (ids.length === 0) return NextResponse.json({ marked_failed: 0 });

  const { error: updateErr } = await supabaseAdmin
    .from("devagent_runs")
    .update({
      status:       "failed",
      error:        "stale: infrastructure crash or sandbox timeout (cleanup cron)",
      completed_at: new Date().toISOString(),
    })
    .in("id", ids);

  if (updateErr) {
    await logEvent({
      category: "system",
      level: "error",
      message: `devagent-cleanup: update failed: ${updateErr.message}`,
    });
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await logEvent({
    category: "system",
    level: "info",
    message: `devagent-cleanup: marked ${ids.length} stale run(s) as failed`,
    metadata: { run_ids: ids },
  });

  return NextResponse.json({ marked_failed: ids.length });
}
