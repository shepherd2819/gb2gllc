import { supabaseAdmin } from "@/lib/supabase";
import { AgentsSidebar, type AgentStatus } from "./AgentsSidebar";
import { AGENTS } from "./agents-manifest";

export const dynamic = "force-dynamic";

type Row = { id: string; status?: string | null };

async function safe<T>(p: PromiseLike<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}
async function rowsOf(p: PromiseLike<{ data: Row[] | null }>): Promise<Row[]> {
  try { return (await p).data ?? []; } catch { return []; }
}
async function countOf(p: PromiseLike<{ count: number | null }>): Promise<number> {
  try { return (await p).count ?? 0; } catch { return 0; }
}

// One pass to gather per-agent status. Each branch fails-soft so a missing
// table or migration drift never breaks the rail.
async function fetchAgentStatuses(): Promise<Record<string, AgentStatus>> {
  const statuses: Record<string, AgentStatus> = {};
  for (const a of AGENTS) statuses[a.slug] = { state: "unconfigured" };

  const [
    iris, wren, holt, nora, vera, avery, june, mark,
  ] = await Promise.all([
    rowsOf(supabaseAdmin.from("iris_inbox_accounts").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("wren_inbox_accounts").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("holt_accounts").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("nora_accounts").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("contracts").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("avery_campaigns").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("june_audits").select("id").limit(5)),
    rowsOf(supabaseAdmin.from("steward_platform_tokens").select("id").eq("platform", "slack").limit(5)),
  ]);

  const [
    irisPending, wrenPending, noraPendingDrafts, holtUpcoming, averyDrafted,
  ] = await Promise.all([
    countOf(supabaseAdmin.from("iris_messages").select("id", { count: "exact", head: true }).eq("status", "classified")),
    countOf(supabaseAdmin.from("wren_messages").select("id", { count: "exact", head: true }).eq("status", "classified")),
    countOf(supabaseAdmin.from("nora_events").select("id", { count: "exact", head: true }).eq("status", "classified").not("draft_body", "is", null)),
    countOf(supabaseAdmin.from("holt_briefings").select("id", { count: "exact", head: true })
      .eq("decision", "briefable")
      .gte("event_start_at", new Date().toISOString())
      .lt("event_start_at", new Date(Date.now() + 24 * 3600_000).toISOString())),
    countOf(supabaseAdmin.from("avery_leads").select("id", { count: "exact", head: true }).eq("status", "drafted")),
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

  void safe; // exported helper retained for future use
  return statuses;
}

function mapStatus(rows: Row[], pending: number): AgentStatus {
  if (rows.length === 0) return { state: "unconfigured" };
  const allPaused = rows.every((r) => r.status === "paused");
  if (allPaused) return { state: "paused" };
  if (pending > 0) return { state: "live", badge: String(pending) };
  return { state: "idle" };
}

export default async function AgentsLayout({ children }: { children: React.ReactNode }) {
  const statuses = await fetchAgentStatuses();
  return (
    <div className="agents-shell">
      <AgentsSidebar statuses={statuses} />
      <div className="agents-content">{children}</div>
    </div>
  );
}
