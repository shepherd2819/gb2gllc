// lib/analytics/providers/spiro.ts
//
// Spiro REST adapter. ALL Spiro HTTP lives in this one file (retell.ts
// convention) so a contract fix touches a single module. Native fetch,
// cache: "no-store", lenient JSON parse, status-code mapping — no throws
// across module boundaries; everything returns the repo-standard Result union.
//
// Auth: per-client API key (decrypted into SourceCtx.secret), sent as
// `Authorization: Bearer <key>` — Spiro's public API is Bearer-only (verified
// live 2026-07-10). config: { baseUrl?: string }.

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
// PATHS verified live against Spiro's OpenAPI (api.spiro.media/swagger/v1/
// swagger.json) + an authenticated probe on 2026-07-10: the reporting summary is
// GET /api/v1/reporting/orders/summary (query: span=month|week|day|year, from/to
// as yyyy-MM-dd, Bearer auth) → { data: SpiroBucket[], meta }. Orders live at
// GET /api/v1/orders (JSON:API filter[field][op] params + pageSize/sort).
// NOTE: the summary endpoint returns only undimensioned time buckets (no group
// field), so dimensioned top-N (Top Companies/Products/Agents) is NOT available
// here — that needs the order-level /api/v1/reporting/orders endpoint aggregated
// client-side, which is deferred (see sync() below).
// ─────────────────────────────────────────────────────────────────────────────
export const SPIRO_PATHS = {
  summarizeReportingOrders: "/api/v1/reporting/orders/summary",
  searchOrders: "/api/v1/orders",
} as const;

// Verified response bucket, e.g. June 2026:
//   { bucketStart: "2026-06-01", bucketEnd: "2026-06-30", orderCount: 286, orderTotal: … }
export type SpiroBucket = {
  bucketStart: string;
  bucketEnd: string;
  orderCount: number;
  orderTotal: number;
  group?: string; // present only when a future grouped query supplies it
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

// Per period: rank groups by revenue, keep the top N, merge the long tail into a
// single `__other__` bucket. Retained as the building block for the DEFERRED
// order-level dimensioned breakdown (/api/v1/reporting/orders aggregated
// client-side); not called by sync() today because the summary endpoint can't
// group.
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
  // Spiro's public API authenticates with a Bearer API key (verified live
  // 2026-07-10 against api.spiro.media). No x-api-key path exists.
  return {
    ok: true,
    headers: { Authorization: `Bearer ${ctx.secret}`, Accept: "application/json" },
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
};

async function summarize(
  ctx: SourceCtx,
  opts: SummarizeOpts,
): Promise<Result<{ buckets: SpiroBucket[] }>> {
  const r = await spiroGet(ctx, SPIRO_PATHS.summarizeReportingOrders, {
    span: opts.span,
    from: opts.from,
    to: opts.to,
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

    // Dimensioned top-N (Top Companies/Products/Agents) is DEFERRED: the summary
    // endpoint returns only undimensioned time buckets (no group field). Real
    // breakdowns need the order-level /api/v1/reporting/orders endpoint
    // aggregated client-side; until then the Command Center shows its graceful
    // "No breakdown data yet" empty state. Core KPIs + trend sync from the two
    // undimensioned queries above.
    return { ok: true, rows };
  },

  // Curated read-only drill-down for chat, executed via REST (/api/v1/orders).
  async chatTools(ctx: SourceCtx): Promise<ChatTool[]> {
    return [
      {
        name: "search_orders",
        description:
          "Search this client's Spiro orders (read-only, newest first). Returns raw order records as JSON. Filter by status and/or a submitted-date range; prefer narrow ranges.",
        input_schema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              description:
                "Order status filter: pending, awaitingConfirmation, confirmed, rescheduled, cancelled, inProgress, appointmentCompleted, editing, or delivered",
            },
            from: { type: "string", description: "Submitted on/after this date, YYYY-MM-DD" },
            to: { type: "string", description: "Submitted on/before this date, YYYY-MM-DD" },
            limit: { type: "number", description: "Max results, default 20, max 50" },
          },
        },
        execute: async (input: Record<string, unknown>) => {
          const limit = Math.min(typeof input.limit === "number" ? input.limit : 20, 50);
          // /api/v1/orders is JSON:API: pageSize + sort + filter[field][op].
          const params: Record<string, string> = {
            pageSize: String(limit),
            sort: "-dateSubmitted",
          };
          if (typeof input.status === "string") params["filter[status][eq]"] = input.status;
          if (typeof input.from === "string") params["filter[dateSubmitted][gte]"] = input.from;
          if (typeof input.to === "string") params["filter[dateSubmitted][lte]"] = input.to;
          const r = await spiroGet(ctx, SPIRO_PATHS.searchOrders, params);
          if (!r.ok) return `Spiro error (${r.kind}): ${r.reason}`;
          return capJson(r.json);
        },
      },
    ];
  },
};
