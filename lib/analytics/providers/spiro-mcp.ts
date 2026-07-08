// lib/analytics/providers/spiro-mcp.ts
//
// Spiro-over-MCP adapter. Same reporting data as lib/analytics/providers/
// spiro.ts (the REST adapter), but this client only has Spiro's MCP — no
// REST API key. Every call goes through the Spiro MCP's tools
// (summarize_spiro_reporting_orders / search_spiro_orders) via the shared
// MCP transport (lib/analytics/mcp.ts). Normalization is NOT reimplemented
// here: SpiroBucket, bucketsToMetricRows, monthWindow, capJson all come from
// spiro.ts because summarize_spiro_reporting_orders returns the exact same
// { data: [{ bucketStart, bucketEnd, orderCount, orderTotal }], meta } shape
// the REST endpoint does.
//
// config: { endpointUrl: string } (the Spiro MCP endpoint); secret = a
// server-usable bearer/access token. kind is "mcp" on the source row.
//
// TESTABILITY: like mcp.ts's McpClientFactory, every exported entry point
// takes an optional trailing SummarizeCaller (defaulting to a real caller
// built from ctx via mcpCallTool) so tests can inject a fake caller and
// exercise happy/error/malformed-JSON paths fully offline — see
// spiro-mcp.test.ts.

import type {
  ChatTool,
  ConnectionInfo,
  MetricRow,
  ProviderAdapter,
  Result,
  SourceCtx,
  SyncWindow,
} from "@/lib/analytics/types";
import { mcpCallTool } from "@/lib/analytics/mcp";
import { endpointFromConfig } from "@/lib/analytics/providers/generic-mcp";
import { bucketsToMetricRows, capJson, monthWindow, type SpiroBucket } from "@/lib/analytics/providers/spiro";

// Verified shape (see spiro.ts header): summarize_spiro_reporting_orders
// returns the same envelope the REST /reporting/orders/summarize endpoint
// does.
export type SpiroSummaryResponse = { data: SpiroBucket[]; meta?: unknown };

// ── Injectable caller (test seam) ───────────────────────────────────────────

export type SummarizeCaller = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Result<{ content: string }>>;

function defaultCaller(ctx: SourceCtx): SummarizeCaller {
  return async (name, args) => {
    const endpoint = endpointFromConfig(ctx.source.config);
    if (!endpoint) {
      return { ok: false, kind: "config", reason: "Spiro MCP source config is missing endpointUrl" };
    }
    return mcpCallTool(endpoint, ctx.secret, name, args);
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Shared tool call + parse (all Spiro MCP reporting reads go through here) ─

type SummarizeOpts = { span: "month" | "week"; from: string; to: string };

async function summarize(
  caller: SummarizeCaller,
  opts: SummarizeOpts,
): Promise<Result<{ buckets: SpiroBucket[] }>> {
  const r = await caller("summarize_spiro_reporting_orders", {
    span: opts.span,
    from: opts.from,
    to: opts.to,
  });
  if (!r.ok) return r;
  let parsed: SpiroSummaryResponse | null;
  try {
    parsed = JSON.parse(r.content) as SpiroSummaryResponse;
  } catch {
    return {
      ok: false,
      kind: "error",
      reason: "Spiro MCP summarize_spiro_reporting_orders returned non-JSON content",
    };
  }
  const data = parsed?.data;
  if (!Array.isArray(data)) {
    return {
      ok: false,
      kind: "error",
      reason: "Spiro MCP summary response missing data[] — re-verify the tool's response shape",
    };
  }
  return { ok: true, buckets: data };
}

// Best-effort text→JSON round-trip so chat tool output is capped consistently
// with the REST adapter's capJson(parsedObject) convention, without
// double-encoding when a tool returns plain (non-JSON) text.
function capToolContent(content: string): string {
  try {
    return capJson(JSON.parse(content));
  } catch {
    const cap = 20000;
    return content.length <= cap ? content : content.slice(0, cap - 12) + "…[truncated]";
  }
}

// ── Adapter entry points (each takes an optional injected caller) ──────────

export async function spiroMcpTestConnection(
  ctx: SourceCtx,
  caller: SummarizeCaller = defaultCaller(ctx),
): Promise<Result<{ info: ConnectionInfo }>> {
  const now = new Date();
  const from = isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const r = await summarize(caller, { span: "month", from, to: isoDate(now) });
  if (!r.ok) return r;
  const bucket = r.buckets[0];
  const detail = bucket
    ? `Spiro MCP OK — ${bucket.orderCount} orders / $${bucket.orderTotal.toLocaleString("en-US")} this month`
    : "Spiro MCP OK — no orders yet this month";
  return { ok: true, info: { detail } };
}

export async function spiroMcpSync(
  ctx: SourceCtx,
  window: SyncWindow,
  caller: SummarizeCaller = defaultCaller(ctx),
): Promise<Result<{ rows: MetricRow[] }>> {
  const months = monthWindow(new Date(), window.backfill);
  const rows: MetricRow[] = [];

  // Undimensioned month grain: trailing 13 months (24 on backfill). Fatal on
  // failure — this is the core KPI/trend query the dashboard depends on.
  const month = await summarize(caller, { span: "month", from: months.from, to: months.to });
  if (!month.ok) return month;
  rows.push(...bucketsToMetricRows(month.buckets, "month"));

  // Undimensioned week grain over the sync window.
  const week = await summarize(caller, { span: "week", from: window.from, to: window.to });
  if (!week.ok) return week;
  rows.push(...bucketsToMetricRows(week.buckets, "week"));

  // TODO(spiro_mcp dimensions): enumerate companies/products/statuses via
  // search_* tools + per-entity summarize filters; MCP summarize takes
  // filters, not groupBy, so the REST adapter's DIMENSIONS/bucketTopN loop
  // (spiro.ts) can't be ported as-is — needs its own per-entity fan-out.

  return { ok: true, rows };
}

export async function spiroMcpChatTools(
  ctx: SourceCtx,
  caller: SummarizeCaller = defaultCaller(ctx),
): Promise<ChatTool[]> {
  return [
    {
      name: "spiro_reporting_summary",
      description:
        "Summarize this client's Spiro orders over a date range via the Spiro MCP reporting tool (read-only). Returns bucketed order counts/totals as JSON.",
      input_schema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Start date YYYY-MM-DD" },
          to: { type: "string", description: "End date YYYY-MM-DD" },
          span: { type: "string", enum: ["month", "week"], description: "Bucket span" },
        },
        required: ["from", "to", "span"],
      },
      execute: async (input: Record<string, unknown>) => {
        const from = typeof input.from === "string" ? input.from : "";
        const to = typeof input.to === "string" ? input.to : "";
        const span = input.span === "week" ? "week" : "month";
        if (!from || !to) return "Spiro MCP error (error): from and to (YYYY-MM-DD) are required";
        const r = await caller("summarize_spiro_reporting_orders", { span, from, to });
        if (!r.ok) return `Spiro MCP error (${r.kind}): ${r.reason}`;
        return capToolContent(r.content);
      },
    },
    {
      name: "search_spiro_orders",
      description:
        "Search this client's Spiro orders via the Spiro MCP (read-only). Returns raw order records as JSON. Prefer narrow date ranges and filters.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text search (address, customer, order number)" },
          status: { type: "string", description: "Order status filter, e.g. completed, scheduled, cancelled" },
          from: { type: "string", description: "Start date YYYY-MM-DD" },
          to: { type: "string", description: "End date YYYY-MM-DD" },
          limit: { type: "number", description: "Max results, default 20, max 50" },
        },
      },
      execute: async (input: Record<string, unknown>) => {
        const limit = Math.min(typeof input.limit === "number" ? input.limit : 20, 50);
        const args: Record<string, unknown> = { limit };
        if (typeof input.query === "string") args.query = input.query;
        if (typeof input.status === "string") args.status = input.status;
        if (typeof input.from === "string") args.from = input.from;
        if (typeof input.to === "string") args.to = input.to;
        const r = await caller("search_spiro_orders", args);
        if (!r.ok) return `Spiro MCP error (${r.kind}): ${r.reason}`;
        return capToolContent(r.content);
      },
    },
  ];
}

export const spiroMcpAdapter: ProviderAdapter = {
  provider: "spiro_mcp",
  testConnection: (ctx) => spiroMcpTestConnection(ctx),
  sync: (ctx, window) => spiroMcpSync(ctx, window),
  chatTools: (ctx) => spiroMcpChatTools(ctx),
};
