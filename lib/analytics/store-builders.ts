// lib/analytics/store-builders.ts
// Pure row/payload shaping for lib/analytics/store.ts, extracted so it can
// be unit-tested without touching supabase (slack-builders.ts convention).
import { dimensionKey } from "./types";
import type { DataSourceRow, Grain, MetricRow, StoredMetric } from "./types";

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export function mapSourceRow(row: Record<string, unknown>): DataSourceRow {
  const allowlist = Array.isArray(row.chat_tool_allowlist)
    ? row.chat_tool_allowlist.filter((t): t is string => typeof t === "string")
    : [];
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    kind: row.kind === "mcp" ? "mcp" : "rest",
    provider: String(row.provider ?? ""),
    label: String(row.label ?? ""),
    config: asObject(row.config),
    secret_enc: typeof row.secret_enc === "string" ? row.secret_enc : null,
    chat_tool_allowlist: allowlist,
    status: row.status === "paused" || row.status === "error" ? row.status : "active",
    last_sync_at: typeof row.last_sync_at === "string" ? row.last_sync_at : null,
    last_sync_error: typeof row.last_sync_error === "string" ? row.last_sync_error : null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export function mapMetricRow(row: Record<string, unknown>): StoredMetric {
  return {
    source_id: String(row.source_id),
    metric: String(row.metric),
    grain: row.grain === "day" || row.grain === "week" ? row.grain : "month",
    period_start: String(row.period_start),
    period_end: String(row.period_end),
    dimension: asObject(row.dimension) as Record<string, string>,
    value: Number(row.value), // PostgREST returns NUMERIC as a string
  };
}

export type MetricUpsertRow = {
  client_id: string;
  source_id: string;
  metric: string;
  grain: Grain;
  period_start: string;
  period_end: string;
  dimension: Record<string, string>;
  dimension_key: string;
  value: number;
  synced_at: string;
};

// Upsert payload for analytics_metrics; dimension_key computed here so the
// UNIQUE(source_id, metric, grain, period_start, dimension_key) constraint
// makes re-syncs idempotent.
export function buildMetricUpsertRows(
  clientId: string,
  sourceId: string,
  rows: MetricRow[],
  syncedAt: string = new Date().toISOString(),
): MetricUpsertRow[] {
  return rows.map((r) => ({
    client_id: clientId,
    source_id: sourceId,
    metric: r.metric,
    grain: r.grain,
    period_start: r.period_start,
    period_end: r.period_end,
    dimension: r.dimension,
    dimension_key: dimensionKey(r.dimension),
    value: r.value,
    synced_at: syncedAt,
  }));
}

export function startOfUtcDayIso(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}
