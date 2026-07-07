// lib/analytics/providers/spiro.ts
//
// Spiro REST adapter. ALL Spiro HTTP lives in this one file (retell.ts
// convention) so a contract fix touches a single module. Native fetch,
// cache: "no-store", lenient JSON parse, status-code mapping — no throws
// across module boundaries; everything returns the repo-standard Result union.
//
// Auth: per-client API key (decrypted into SourceCtx.secret), sent as
// `x-api-key` or `Authorization: Bearer` per config.authScheme.
// config: { baseUrl?: string; authScheme?: "x-api-key" | "bearer" }.

import type {
  ChatTool,
  ConnectionInfo,
  Grain,
  MetricRow,
  ProviderAdapter,
  Result,
  SourceCtx,
  SyncWindow,
} from "@/lib/analytics/types";

const DEFAULT_BASE_URL = "https://api.spiro.media";

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: these PATHS must be verified against the client's OpenAPI
// contract (served from their Spiro account) at first connect — REST paths
// were not directly observable on 2026-07-07. The RESPONSE shape
// (SpiroSummaryResponse below) WAS verified live via Spiro's MCP proxy on
// 2026-07-07 (summarize_spiro_reporting_orders / search_spiro_reporting_orders)
// and is authoritative. If a path 404s at first connect, fix it HERE only.
// ─────────────────────────────────────────────────────────────────────────────
export const SPIRO_PATHS = {
  summarizeReportingOrders: "/reporting/orders/summarize",
  searchOrders: "/orders/search",
} as const;

// Verified response bucket, e.g. June 2026:
//   { bucketStart: "2026-06-01", bucketEnd: "2026-06-30", orderCount: 286, orderTotal: 100054.3 }
export type SpiroBucket = {
  bucketStart: string;
  bucketEnd: string;
  orderCount: number;
  orderTotal: number;
  group?: string; // present when the query grouped by a dimension
};

export type SpiroSummaryResponse = {
  data: SpiroBucket[];
  meta?: { span?: string; dateRange?: Record<string, unknown> };
};

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

export function mapSpiroStatus(status: number): "auth" | "network" | "error" {
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "network";
  return "error";
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Trailing N monthly buckets including the current month.
export function monthWindow(now: Date, backfill: boolean): { from: string; to: string } {
  const months = backfill ? 24 : 13;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  return { from: isoDate(from), to: isoDate(now) };
}

export function bucketsToMetricRows(
  buckets: SpiroBucket[],
  grain: Grain,
  dimension: Record<string, string> = {},
): MetricRow[] {
  const rows: MetricRow[] = [];
  for (const b of buckets) {
    rows.push({
      metric: "orders.count",
      grain,
      period_start: b.bucketStart,
      period_end: b.bucketEnd,
      dimension,
      value: b.orderCount,
    });
    rows.push({
      metric: "orders.revenue",
      grain,
      period_start: b.bucketStart,
      period_end: b.bucketEnd,
      dimension,
      value: b.orderTotal,
    });
  }
  return rows;
}

// Per period: rank groups by revenue, keep the top N, merge the long tail
// into a single `__other__` bucket (both metrics stay consistent because the
// same group membership is applied to counts and revenue).
export function bucketTopN(
  buckets: SpiroBucket[],
  dimensionName: string,
  grain: Grain,
  topN = 10,
): MetricRow[] {
  const byPeriod = new Map<string, SpiroBucket[]>();
  for (const b of buckets) {
    const key = `${b.bucketStart}|${b.bucketEnd}`;
    const list = byPeriod.get(key) ?? [];
    list.push(b);
    byPeriod.set(key, list);
  }
  const rows: MetricRow[] = [];
  for (const list of byPeriod.values()) {
    const sorted = [...list].sort((a, b) => b.orderTotal - a.orderTotal);
    const top = sorted.slice(0, topN);
    const tail = sorted.slice(topN);
    for (const b of top) {
      rows.push(...bucketsToMetricRows([b], grain, { [dimensionName]: b.group ?? "unknown" }));
    }
    if (tail.length > 0) {
      const other: SpiroBucket = {
        bucketStart: tail[0].bucketStart,
        bucketEnd: tail[0].bucketEnd,
        orderCount: tail.reduce((s, b) => s + b.orderCount, 0),
        orderTotal: tail.reduce((s, b) => s + b.orderTotal, 0),
      };
      rows.push(...bucketsToMetricRows([other], grain, { [dimensionName]: "__other__" }));
    }
  }
  return rows;
}

export function capJson(value: unknown, cap = 20000): string {
  const s = JSON.stringify(value);
  if (s.length <= cap) return s;
  return s.slice(0, cap - 12) + "…[truncated]";
}

// ── HTTP (all Spiro network I/O below this line) ────────────────────────────

function baseUrl(ctx: SourceCtx): string {
  const b = ctx.source.config.baseUrl;
  return typeof b === "string" && b.length > 0 ? b.replace(/\/$/, "") : DEFAULT_BASE_URL;
}

function authHeaders(ctx: SourceCtx): Result<{ headers: Record<string, string> }> {
  if (!ctx.secret) {
    return { ok: false, kind: "config", reason: "Spiro source has no API key configured" };
  }
  const bearer = ctx.source.config.authScheme === "bearer";
  return {
    ok: true,
    headers: bearer
      ? { Authorization: `Bearer ${ctx.secret}`, Accept: "application/json" }
      : { "x-api-key": ctx.secret, Accept: "application/json" },
  };
}

async function spiroGet(
  ctx: SourceCtx,
  path: string,
  params: Record<string, string>,
): Promise<Result<{ json: unknown }>> {
  const auth = authHeaders(ctx);
  if (!auth.ok) return auth;
  const url = new URL(`${baseUrl(ctx)}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let text: string;
  let status: number;
  let ok: boolean;
  try {
    const res = await fetch(url, { headers: auth.headers, cache: "no-store" });
    status = res.status;
    ok = res.ok;
    text = await res.text();
  } catch (e) {
    return {
      ok: false,
      kind: "network",
      reason: `Network error reaching Spiro: ${(e as Error).message}`,
    };
  }
  if (!ok) {
    return {
      ok: false,
      kind: mapSpiroStatus(status),
      reason: `Spiro ${path} ${status}: ${text.slice(0, 200)}`,
    };
  }
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, kind: "error", reason: `Spiro ${path} returned non-JSON (status ${status})` };
  }
}

type SummarizeOpts = {
  span: "month" | "week";
  from: string;
  to: string;
  groupBy?: "company" | "product" | "status";
};

async function summarize(
  ctx: SourceCtx,
  opts: SummarizeOpts,
): Promise<Result<{ buckets: SpiroBucket[] }>> {
  const r = await spiroGet(ctx, SPIRO_PATHS.summarizeReportingOrders, {
    span: opts.span,
    from: opts.from,
    to: opts.to,
    ...(opts.groupBy ? { groupBy: opts.groupBy } : {}),
  });
  if (!r.ok) return r;
  const data = (r.json as SpiroSummaryResponse | null)?.data;
  if (!Array.isArray(data)) {
    return {
      ok: false,
      kind: "error",
      reason: "Spiro summary response missing data[] — re-verify SPIRO_PATHS against the OpenAPI contract",
    };
  }
  return { ok: true, buckets: data };
}

// ── Adapter ─────────────────────────────────────────────────────────────────

const DIMENSIONS = ["company", "product", "status"] as const;

export const spiroAdapter: ProviderAdapter = {
  provider: "spiro",

  // Cheapest reporting query: current-month summary.
  async testConnection(ctx: SourceCtx): Promise<Result<{ info: ConnectionInfo }>> {
    const now = new Date();
    const from = isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
    const r = await summarize(ctx, { span: "month", from, to: isoDate(now) });
    if (!r.ok) return r;
    const bucket = r.buckets[0];
    const detail = bucket
      ? `Spiro reporting OK — ${bucket.orderCount} orders / $${bucket.orderTotal.toLocaleString("en-US")} so far this month`
      : "Spiro reporting OK — no orders yet this month";
    return { ok: true, info: { detail } };
  },

  async sync(ctx: SourceCtx, window: SyncWindow): Promise<Result<{ rows: MetricRow[] }>> {
    const months = monthWindow(new Date(), window.backfill);
    const rows: MetricRow[] = [];

    // Undimensioned month grain: trailing 13 months (24 on backfill).
    const month = await summarize(ctx, { span: "month", from: months.from, to: months.to });
    if (!month.ok) return month;
    rows.push(...bucketsToMetricRows(month.buckets, "month"));

    // Undimensioned week grain over the sync window.
    const week = await summarize(ctx, { span: "week", from: window.from, to: window.to });
    if (!week.ok) return week;
    rows.push(...bucketsToMetricRows(week.buckets, "week"));

    // Dimensioned month grain: top 10 per period, long tail as __other__.
    for (const dim of DIMENSIONS) {
      const grouped = await summarize(ctx, {
        span: "month",
        from: months.from,
        to: months.to,
        groupBy: dim,
      });
      if (!grouped.ok) return grouped;
      rows.push(...bucketTopN(grouped.buckets, dim, "month", 10));
    }

    return { ok: true, rows };
  },

  // Curated read-only drill-downs for chat, executed via REST.
  async chatTools(ctx: SourceCtx): Promise<ChatTool[]> {
    return [
      {
        name: "search_orders",
        description:
          "Search this client's Spiro orders (read-only). Returns raw order records as JSON. Prefer narrow date ranges and filters.",
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
          const params: Record<string, string> = { limit: String(limit) };
          if (typeof input.query === "string") params.query = input.query;
          if (typeof input.status === "string") params.status = input.status;
          if (typeof input.from === "string") params.from = input.from;
          if (typeof input.to === "string") params.to = input.to;
          const r = await spiroGet(ctx, SPIRO_PATHS.searchOrders, params);
          if (!r.ok) return `Spiro error (${r.kind}): ${r.reason}`;
          return capJson(r.json);
        },
      },
      {
        name: "top_companies",
        description:
          "Rank this client's Spiro companies (brokerages/agencies) by order revenue over a date range (read-only).",
        input_schema: {
          type: "object",
          properties: {
            from: { type: "string", description: "Start date YYYY-MM-DD" },
            to: { type: "string", description: "End date YYYY-MM-DD" },
            limit: { type: "number", description: "Max companies, default 10, max 25" },
          },
          required: ["from", "to"],
        },
        execute: async (input: Record<string, unknown>) => {
          const from = typeof input.from === "string" ? input.from : "";
          const to = typeof input.to === "string" ? input.to : "";
          if (!from || !to) return "Spiro error (error): from and to (YYYY-MM-DD) are required";
          const r = await summarize(ctx, { span: "month", from, to, groupBy: "company" });
          if (!r.ok) return `Spiro error (${r.kind}): ${r.reason}`;
          const limit = Math.min(typeof input.limit === "number" ? input.limit : 10, 25);
          const totals = new Map<string, { revenue: number; orders: number }>();
          for (const b of r.buckets) {
            const name = b.group ?? "unknown";
            const t = totals.get(name) ?? { revenue: 0, orders: 0 };
            t.revenue += b.orderTotal;
            t.orders += b.orderCount;
            totals.set(name, t);
          }
          const ranked = [...totals.entries()]
            .map(([name, t]) => ({ name, revenue: t.revenue, orders: t.orders }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, limit);
          return capJson(ranked);
        },
      },
    ];
  },
};
