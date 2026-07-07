// lib/analytics/types.ts
// Shared analytics contract: result unions, source/metric shapes, the
// provider-adapter interface, and dimension_key canonicalization.
// Leaf module — no repo imports — so anything may depend on it.

export type Err = {
  ok: false;
  kind: "config" | "auth" | "network" | "unsupported" | "error";
  reason: string;
};
export type Result<T> = ({ ok: true } & T) | Err;

export type SourceKind = "mcp" | "rest";
export type Grain = "day" | "week" | "month";

// Mirrors a client_data_sources row (migration 032).
export type DataSourceRow = {
  id: string;
  client_id: string;
  kind: SourceKind;
  provider: string;
  label: string;
  config: Record<string, unknown>;
  secret_enc: string | null;
  chat_tool_allowlist: string[];
  status: "active" | "paused" | "error";
  last_sync_at: string | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
};

// A source plus its decrypted credential — built server-side only
// (lib/analytics/store.ts toSourceCtx); never serialized to a client.
export type SourceCtx = { source: DataSourceRow; secret: string | null };

export type MetricRow = {
  metric: string;
  grain: Grain;
  period_start: string; // ISO date (YYYY-MM-DD)
  period_end: string;   // ISO date (YYYY-MM-DD)
  dimension: Record<string, string>;
  value: number;
};

export type StoredMetric = MetricRow & { source_id: string };

export type SyncWindow = { from: string; to: string; backfill: boolean };

export type ConnectionInfo = { detail: string; toolNames?: string[] };

// Audit record for one tool invocation inside a chat turn.
export type ToolCallRecord = {
  name: string;
  input: Record<string, unknown>;
  sourceId?: string;
  ms: number;
  ok: boolean;
};

// An Anthropic tool definition plus its server-side executor.
export type ChatTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<string>;
};

export interface ProviderAdapter {
  provider: string;
  testConnection(ctx: SourceCtx): Promise<Result<{ info: ConnectionInfo }>>;
  sync(ctx: SourceCtx, window: SyncWindow): Promise<Result<{ rows: MetricRow[] }>>;
  chatTools(ctx: SourceCtx): Promise<ChatTool[]>;
}

// Canonical serialization of a dimension object for the warehouse UNIQUE key
// (analytics_metrics.dimension_key): sorted keys, k=v pairs joined with '|',
// empty object → "". '|' and '=' inside VALUES are escaped (%7C / %3D) so the
// serialization stays unambiguous; keys are trusted metric-code identifiers.
export function dimensionKey(dimension: Record<string, string>): string {
  return Object.keys(dimension)
    .sort()
    .map((k) => `${k}=${dimension[k].replace(/\|/g, "%7C").replace(/=/g, "%3D")}`)
    .join("|");
}
