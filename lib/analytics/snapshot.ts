// lib/analytics/snapshot.ts
//
// Pure snapshot computation: warehouse metric rows → the precomputed payload
// the dashboard reads in one query (nora last_metrics_json pattern).
// Deterministic given (metrics, sources, now) — all date math is UTC.

import type { DataSourceRow, StoredMetric } from "./types";
import type { InsightCard } from "./insights";

export type SnapshotPayload = {
  generatedAt: string;
  kpis: {
    revenueThisMonth: number;
    ordersThisMonth: number;
    avgOrderValue: number;
    activeCustomers: number;
    revenueMoM: number | null;
    ordersMoM: number | null;
  };
  trend: Array<{ month: string; revenue: number; orders: number }>;
  productMix: Array<{ name: string; revenue: number }>;
  statusMix: Array<{ name: string; count: number }>;
  topCompanies: Array<{ name: string; revenue: number; orders: number }>;
  topAgents: Array<{ name: string; revenue: number; orders: number }>;
  sources: Array<{
    id: string;
    label: string;
    provider: string;
    status: string;
    lastSyncAt: string | null;
    lastSyncError: string | null;
  }>;
};

export type SnapshotRow = {
  client_id: string;
  payload: SnapshotPayload;
  insights: InsightCard[];
  computed_at: string;
};

const TREND_MONTHS = 13; // current month + 12 back
const MIX_MONTHS = 3; // trailing window for mixes and top lists
const TOP_N = 5; // topCompanies / topAgents cap
const OTHER = "__other__"; // adapter long-tail bucket

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function computeSnapshot(
  metrics: StoredMetric[],
  sources: DataSourceRow[],
  now: Date,
): SnapshotPayload {
  // "2025-07" … "2026-07": oldest → newest, TREND_MONTHS entries.
  const months: string[] = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`);
  }
  const currentMonth = months[months.length - 1];
  const prevMonth = months[months.length - 2];
  const mixMonths = new Set(months.slice(-MIX_MONTHS));

  const monthRows = metrics.filter((m) => m.grain === "month");
  const monthOf = (m: StoredMetric) => m.period_start.slice(0, 7);
  const isUndimensioned = (m: StoredMetric) => Object.keys(m.dimension).length === 0;

  const sumUndim = (metric: string, month: string): number =>
    monthRows
      .filter((m) => m.metric === metric && isUndimensioned(m) && monthOf(m) === month)
      .reduce((acc, m) => acc + m.value, 0);

  // ── KPIs (current calendar month) ──────────────────────────────────────
  const revenueThisMonth = round2(sumUndim("orders.revenue", currentMonth));
  const ordersThisMonth = round2(sumUndim("orders.count", currentMonth));
  const avgOrderValue = ordersThisMonth > 0 ? round2(revenueThisMonth / ordersThisMonth) : 0;

  const activeCustomers = new Set(
    monthRows
      .filter(
        (m) => monthOf(m) === currentMonth && m.dimension.company && m.dimension.company !== OTHER,
      )
      .map((m) => m.dimension.company),
  ).size;

  const prevRevenue = sumUndim("orders.revenue", prevMonth);
  const prevOrders = sumUndim("orders.count", prevMonth);
  const revenueMoM = prevRevenue > 0 ? round4((revenueThisMonth - prevRevenue) / prevRevenue) : null;
  const ordersMoM = prevOrders > 0 ? round4((ordersThisMonth - prevOrders) / prevOrders) : null;

  // ── 13-month trend, zero-filled ────────────────────────────────────────
  const trend = months.map((month) => ({
    month,
    revenue: round2(sumUndim("orders.revenue", month)),
    orders: round2(sumUndim("orders.count", month)),
  }));

  // ── Dimensioned aggregates over the trailing MIX_MONTHS months ────────
  const aggregate = (metric: string, dim: string): Map<string, number> => {
    const out = new Map<string, number>();
    for (const m of monthRows) {
      if (m.metric !== metric) continue;
      if (!mixMonths.has(monthOf(m))) continue;
      const key = m.dimension[dim];
      if (!key) continue;
      out.set(key, (out.get(key) ?? 0) + m.value);
    }
    return out;
  };

  const productRevenue = aggregate("orders.revenue", "product");
  const productMix = [...productRevenue.entries()]
    .filter(([name]) => name !== OTHER)
    .sort((a, b) => b[1] - a[1])
    .map(([name, revenue]) => ({ name, revenue: round2(revenue) }));
  const otherRevenue = productRevenue.get(OTHER);
  if (otherRevenue !== undefined) productMix.push({ name: "Other", revenue: round2(otherRevenue) });

  const statusCounts = aggregate("orders.count", "status");
  const statusMix = [...statusCounts.entries()]
    .filter(([name]) => name !== OTHER)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count: round2(count) }));

  const topList = (dim: string): Array<{ name: string; revenue: number; orders: number }> => {
    const revenue = aggregate("orders.revenue", dim);
    const orders = aggregate("orders.count", dim);
    const names = new Set([...revenue.keys(), ...orders.keys()]);
    names.delete(OTHER);
    return [...names]
      .map((name) => ({
        name,
        revenue: round2(revenue.get(name) ?? 0),
        orders: round2(orders.get(name) ?? 0),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, TOP_N);
  };

  return {
    generatedAt: now.toISOString(),
    kpis: { revenueThisMonth, ordersThisMonth, avgOrderValue, activeCustomers, revenueMoM, ordersMoM },
    trend,
    productMix,
    statusMix,
    topCompanies: topList("company"),
    topAgents: topList("agent"),
    sources: sources.map((s) => ({
      id: s.id,
      label: s.label,
      provider: s.provider,
      status: s.status,
      lastSyncAt: s.last_sync_at,
      lastSyncError: s.last_sync_error,
    })),
  };
}
