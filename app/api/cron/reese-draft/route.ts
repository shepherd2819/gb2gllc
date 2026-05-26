import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { draftLinkedinPost } from "@/lib/reese";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily Reese draft generator. Cron fires at 13:00 UTC (8am ET, 7am CT, etc).
// Generates one fresh draft per client whose cadence requires a post today
// AND who doesn't already have a pending draft in queue.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dow = new Date().getUTCDay(); // 0=Sun, 1=Mon, ... 6=Sat
  // Configs that want a post today based on cadence
  const { data: cfgs } = await supabaseAdmin
    .from("client_linkedin_configs")
    .select("client_id, posting_cadence, content_pillars");

  const due = (cfgs ?? []).filter((c) => isDueToday(c.posting_cadence, dow) && (c.content_pillars ?? []).length > 0);

  const results: Array<{ client_id: string; status: "drafted" | "skipped" | "errored"; reason?: string }> = [];

  for (const c of due) {
    // Skip if there's already a draft in queue for this client
    const { count: pending } = await supabaseAdmin
      .from("linkedin_posts")
      .select("id", { count: "exact", head: true })
      .eq("client_id", c.client_id)
      .in("status", ["draft", "approved"]);
    if ((pending ?? 0) > 0) {
      results.push({ client_id: c.client_id, status: "skipped", reason: "already-pending" });
      continue;
    }

    const draft = await draftLinkedinPost({ clientId: c.client_id });
    if (!draft.ok) {
      results.push({ client_id: c.client_id, status: "errored", reason: draft.error });
      continue;
    }

    await supabaseAdmin.from("linkedin_posts").insert({
      client_id: c.client_id,
      pillar: draft.pillar,
      draft_text: draft.text,
      status: "draft",
      draft_model: draft.model,
      draft_tokens: draft.tokens,
    });
    results.push({ client_id: c.client_id, status: "drafted" });
  }

  return NextResponse.json({
    ok: true,
    ran_at: new Date().toISOString(),
    drafted: results.filter((r) => r.status === "drafted").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errored: results.filter((r) => r.status === "errored").length,
    results,
  });
}

function isDueToday(cadence: string | null, dow: number): boolean {
  switch ((cadence ?? "weekdays").toLowerCase()) {
    case "daily":    return true;
    case "weekdays": return dow >= 1 && dow <= 5;
    case "mwf":      return dow === 1 || dow === 3 || dow === 5;
    case "ondemand": return false;
    default:         return dow >= 1 && dow <= 5;
  }
}
