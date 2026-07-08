// lib/analytics/store.ts
// Thin supabaseAdmin wrappers around the analytics tables (migration 032).
// Pure row/payload shaping lives in ./store-builders (unit-tested there).
// Tenant isolation is MANUAL: every clientId passed in must come from
// getPortalClientId(user.id) (portal) or the [id] route param under
// requireAdmin() (admin) — NEVER from a request body.
import { supabaseAdmin } from "@/lib/supabase";
import { decryptSecret } from "./crypto";
import { dimensionKey } from "./types";
import type { DataSourceRow, Grain, MetricRow, SourceCtx, StoredMetric, ToolCallRecord } from "./types";
import type { InsightCard } from "./insights";
import type { SnapshotPayload, SnapshotRow } from "./snapshot";
import { buildMetricUpsertRows, mapMetricRow, mapSourceRow, startOfUtcDayIso } from "./store-builders";

// clientId omitted = all clients (daily cron sync); pass it everywhere else.
export async function listActiveSources(clientId?: string): Promise<DataSourceRow[]> {
  let query = supabaseAdmin
    .from("client_data_sources")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) throw new Error(`listActiveSources: ${error.message}`);
  return (data ?? []).map(mapSourceRow);
}

export async function getSource(sourceId: string): Promise<DataSourceRow | null> {
  const { data, error } = await supabaseAdmin
    .from("client_data_sources")
    .select("*")
    .eq("id", sourceId)
    .maybeSingle();
  if (error) throw new Error(`getSource: ${error.message}`);
  return data ? mapSourceRow(data) : null;
}

// Decrypts secret_enc — server-side only; never serialize a SourceCtx.
export function toSourceCtx(row: DataSourceRow): SourceCtx {
  return { source: row, secret: row.secret_enc ? decryptSecret(row.secret_enc) : null };
}

export async function upsertMetrics(clientId: string, sourceId: string, rows: MetricRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const payload = buildMetricUpsertRows(clientId, sourceId, rows);
  const { error } = await supabaseAdmin
    .from("analytics_metrics")
    .upsert(payload, { onConflict: "source_id,metric,grain,period_start,dimension_key" });
  if (error) throw new Error(`upsertMetrics: ${error.message}`);
  return payload.length;
}

// Non-secret config write (used by the OAuth connect flow — see
// lib/analytics/oauth.ts — to persist authMode/endpointUrl and the
// non-secret client_id/discovery bits SourceOAuthProvider accumulates).
export async function updateSourceConfig(sourceId: string, config: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin
    .from("client_data_sources")
    .update({ config, updated_at: new Date().toISOString() })
    .eq("id", sourceId);
  if (error) throw new Error(`updateSourceConfig: ${error.message}`);
}

// secretEnc = null clears the stored credential blob entirely. Used by the
// OAuth connect flow to persist the encrypted { codeVerifier?, clientSecret?,
// tokens? } bundle — see lib/analytics/oauth.ts.
export async function updateSourceSecret(sourceId: string, secretEnc: string | null): Promise<void> {
  const { error } = await supabaseAdmin
    .from("client_data_sources")
    .update({ secret_enc: secretEnc, updated_at: new Date().toISOString() })
    .eq("id", sourceId);
  if (error) throw new Error(`updateSourceSecret: ${error.message}`);
}

export async function setSourceStatus(sourceId: string, status: "active" | "paused" | "error"): Promise<void> {
  const { error } = await supabaseAdmin
    .from("client_data_sources")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", sourceId);
  if (error) throw new Error(`setSourceStatus: ${error.message}`);
}

// error = null marks success (status back to 'active'); a string marks failure.
export async function markSyncResult(sourceId: string, error: string | null): Promise<void> {
  const now = new Date().toISOString();
  const { error: dbError } = await supabaseAdmin
    .from("client_data_sources")
    .update({
      last_sync_at: now,
      last_sync_error: error,
      status: error ? "error" : "active",
      updated_at: now,
    })
    .eq("id", sourceId);
  if (dbError) throw new Error(`markSyncResult: ${dbError.message}`);
}

const METRICS_PAGE_SIZE = 1000; // PostgREST caps responses at 1000 rows; paginate

export async function listMetricsForClient(
  clientId: string,
  opts: { grains: Grain[]; from: string },
): Promise<StoredMetric[]> {
  const out: StoredMetric[] = [];
  for (let offset = 0; ; offset += METRICS_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("analytics_metrics")
      .select("*")
      .eq("client_id", clientId)
      .in("grain", opts.grains)
      .gte("period_start", opts.from)
      .order("period_start", { ascending: true })
      .order("id", { ascending: true }) // stable tiebreak so pages never overlap
      .range(offset, offset + METRICS_PAGE_SIZE - 1);
    if (error) throw new Error(`listMetricsForClient: ${error.message}`);
    const page = data ?? [];
    out.push(...page.map(mapMetricRow));
    if (page.length < METRICS_PAGE_SIZE) return out;
  }
}

// dimension omitted (or {}) → undimensioned series only (dimension_key = ""),
// so totals are never double-counted against dimensioned rows. Capped 500.
export async function queryMetrics(
  clientId: string,
  q: { metric: string; grain: Grain; from: string; to: string; dimension?: Record<string, string> },
): Promise<StoredMetric[]> {
  const { data, error } = await supabaseAdmin
    .from("analytics_metrics")
    .select("*")
    .eq("client_id", clientId)
    .eq("metric", q.metric)
    .eq("grain", q.grain)
    .gte("period_start", q.from)
    .lte("period_start", q.to)
    .eq("dimension_key", dimensionKey(q.dimension ?? {}))
    .order("period_start", { ascending: true })
    .limit(500);
  if (error) throw new Error(`queryMetrics: ${error.message}`);
  return (data ?? []).map(mapMetricRow);
}

export async function readSnapshot(clientId: string): Promise<SnapshotRow | null> {
  const { data, error } = await supabaseAdmin
    .from("analytics_snapshots")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(`readSnapshot: ${error.message}`);
  if (!data) return null;
  return {
    client_id: String(data.client_id),
    payload: data.payload as SnapshotPayload,
    insights: (Array.isArray(data.insights) ? data.insights : []) as InsightCard[],
    computed_at: String(data.computed_at),
  };
}

// insights = null preserves whatever insights are already stored (sync can
// refresh the payload without clobbering the last successful AI generation).
export async function writeSnapshot(
  clientId: string,
  payload: SnapshotPayload,
  insights: InsightCard[] | null,
): Promise<void> {
  let effectiveInsights: InsightCard[] = insights ?? [];
  if (insights === null) {
    const existing = await readSnapshot(clientId);
    effectiveInsights = existing?.insights ?? [];
  }
  const { error } = await supabaseAdmin
    .from("analytics_snapshots")
    .upsert(
      {
        client_id: clientId,
        payload,
        insights: effectiveInsights,
        computed_at: new Date().toISOString(),
      },
      { onConflict: "client_id" },
    );
  if (error) throw new Error(`writeSnapshot: ${error.message}`);
}

// Audit is fail-soft: a failed audit insert must never break the user-facing
// action it records (spec §9.5 posture).
export async function recordEvent(
  clientId: string,
  kind: string,
  actor: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("analytics_events")
    .insert({ client_id: clientId, kind, actor, payload: payload ?? {} });
  if (error) console.error(`[analytics] recordEvent failed (${kind}): ${error.message}`);
}

// A conversationId that doesn't exist — or belongs to ANOTHER client — falls
// through to creating a fresh conversation (cross-tenant safe by construction).
export async function getOrCreateConversation(
  clientId: string,
  createdBy: string,
  conversationId?: string,
): Promise<{ id: string }> {
  if (conversationId) {
    const { data, error } = await supabaseAdmin
      .from("analytics_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) throw new Error(`getOrCreateConversation: ${error.message}`);
    if (data) return { id: String(data.id) };
  }
  const { data, error } = await supabaseAdmin
    .from("analytics_conversations")
    .insert({ client_id: clientId, created_by: createdBy })
    .select("id")
    .single();
  if (error) throw new Error(`getOrCreateConversation: ${error.message}`);
  return { id: String(data.id) };
}

export async function listMessages(
  conversationId: string,
  clientId: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const { data, error } = await supabaseAdmin
    .from("analytics_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listMessages: ${error.message}`);
  return (data ?? []).map((m) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: String(m.content ?? ""),
  }));
}

export async function appendMessage(opts: {
  conversationId: string;
  clientId: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallRecord[];
  model?: string;
  tokensUsed?: number;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("analytics_messages").insert({
    conversation_id: opts.conversationId,
    client_id: opts.clientId,
    role: opts.role,
    content: opts.content,
    tool_calls: opts.toolCalls ?? [],
    model: opts.model ?? null,
    tokens_used: opts.tokensUsed ?? null,
  });
  if (error) throw new Error(`appendMessage: ${error.message}`);
}

// Counts USER-role messages since UTC midnight — the number the chat route
// compares against DAILY_MESSAGE_CAP (DB-based; survives instance restarts).
export async function countMessagesToday(clientId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("analytics_messages")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("role", "user")
    .gte("created_at", startOfUtcDayIso(new Date()));
  if (error) throw new Error(`countMessagesToday: ${error.message}`);
  return count ?? 0;
}
