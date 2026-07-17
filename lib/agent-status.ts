// Fail-soft per-agent status for the admin shell rail. Moved out of
// app/(admin)/agents/layout.tsx so the root (admin) layout can badge the
// global sidebar. Every branch fails soft — a missing table or migration
// drift must never break the shell.
import { supabaseAdmin } from "@/lib/supabase";
import { AGENTS } from "@/app/(admin)/agents/agents-manifest";

export type AgentStatus = {
  state: "live" | "idle" | "paused" | "unconfigured"; // live = connected + recent activity; idle = connected but quiet; paused = explicitly paused; unconfigured = nothing connected
  badge?: string | null;                              // e.g. "3" for pending count
};

type Row = { id: string; status?: string | null };

async function rowsOf(p: PromiseLike<{ data: Row[] | null }>): Promise<Row[]> {
  try { return (await p).data ?? []; } catch { return []; }
}
async function countOf(p: PromiseLike<{ count: number | null }>): Promise<number> {
  try { return (await p).count ?? 0; } catch { return 0; }
}

export async function fetchAgentStatuses(): Promise<Record<string, AgentStatus>> {
  const statuses: Record<string, AgentStatus> = {};
  for (const a of AGENTS) statuses[a.slug] = { state: "unconfigured" };

  const [
    iris, wren, holt, nora, vera, avery, june, mark, hollis,
  ] = await Promise.all([
    rowsOf(supabaseAdmin.from("iris_inbox_accounts").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("wren_inbox_accounts").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("holt_accounts").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("nora_accounts").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("contracts").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("avery_campaigns").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("june_audits").select("id").limit(5)),
    rowsOf(supabaseAdmin.from("steward_platform_tokens").select("id").eq("platform", "slack").limit(5)),
    rowsOf(supabaseAdmin.from("hollis_lines").select("id, status").neq("status", "released").limit(5)),
  ]);

  const [
    irisPending, wrenPending, noraPendingDrafts, holtUpcoming, averyDrafted, hollisFollowups,
  ] = await Promise.all([
    countOf(supabaseAdmin.from("iris_messages").select("id", { count: "exact", head: true }).eq("status", "classified")),
    countOf(supabaseAdmin.from("wren_messages").select("id", { count: "exact", head: true }).eq("status", "classified")),
    countOf(supabaseAdmin.from("nora_events").select("id", { count: "exact", head: true }).eq("status", "classified").not("draft_body", "is", null)),
    countOf(supabaseAdmin.from("holt_briefings").select("id", { count: "exact", head: true })
      .eq("decision", "briefable")
      .gte("event_start_at", new Date().toISOString())
      .lt("event_start_at", new Date(Date.now() + 24 * 3600_000).toISOString())),
    countOf(supabaseAdmin.from("avery_leads").select("id", { count: "exact", head: true }).eq("status", "drafted")),
    countOf(supabaseAdmin.from("hollis_calls").select("id", { count: "exact", head: true })
      .in("outcome", ["booking_request", "message", "transfer"])
      .gte("created_at", new Date(Date.now() - 7 * 24 * 3600_000).toISOString())),
  ]);

  statuses.iris  = mapStatus(iris,  irisPending);
  statuses.wren  = mapStatus(wren,  wrenPending);
  statuses.holt  = mapStatus(holt,  holtUpcoming);
  statuses.nora  = mapStatus(nora,  noraPendingDrafts);
  statuses.vera  = vera.length > 0 ? { state: "live" } : { state: "unconfigured" };
  statuses.avery = averyDrafted > 0
    ? { state: "live", badge: String(averyDrafted) }
    : avery.length > 0 ? { state: avery.some((c) => c.status === "active") ? "live" : "idle" } : { state: "unconfigured" };
  statuses.june  = june.length > 0 ? { state: "live" } : { state: "idle" };
  statuses.mark  = mark.length > 0 ? { state: "live" } : { state: "unconfigured" };
  statuses.hollis = mapStatus(hollis, hollisFollowups);

  return statuses;
}

function mapStatus(rows: Row[], pending: number): AgentStatus {
  if (rows.length === 0) return { state: "unconfigured" };
  const allPaused = rows.every((r) => r.status === "paused");
  if (allPaused) return { state: "paused" };
  if (pending > 0) return { state: "live", badge: String(pending) };
  return { state: "idle" };
}
