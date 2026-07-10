// lib/analytics/snapshot.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSnapshot } from "./snapshot";
import type { DataSourceRow, StoredMetric } from "./types";

const NOW = new Date("2026-07-15T12:00:00.000Z");

function row(
  metric: string,
  periodStart: string,
  value: number,
  dimension: Record<string, string> = {},
): StoredMetric {
  return {
    source_id: "src-1",
    metric,
    grain: "month",
    period_start: periodStart,
    period_end: periodStart,
    dimension,
    value,
  };
}

function source(overrides: Partial<DataSourceRow> = {}): DataSourceRow {
  return {
    id: "src-1",
    client_id: "client-1",
    kind: "rest",
    provider: "spiro",
    label: "Spiro — production",
    config: {},
    secret_enc: null,
    chat_tool_allowlist: [],
    status: "active",
    last_sync_at: "2026-07-15T09:00:00.000Z",
    last_sync_error: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-07-15T09:00:00.000Z",
    ...overrides,
  };
}

const FIXTURE: StoredMetric[] = [
  // Current month (2026-07), undimensioned
  row("orders.revenue", "2026-07-01", 100000),
  row("orders.count", "2026-07-01", 250),
  // Previous month (2026-06), undimensioned
  row("orders.revenue", "2026-06-01", 80000),
  row("orders.count", "2026-06-01", 200),
  // Older month inside the 13-month window
  row("orders.revenue", "2025-09-01", 152925),
  row("orders.count", "2025-09-01", 507),
  // Outside the window (14 months back) — must be ignored
  row("orders.revenue", "2025-05-01", 999999),
  // Current-month company dimensions (activeCustomers + topCompanies)
  row("orders.revenue", "2026-07-01", 30000, { company: "Acme Realty" }),
  row("orders.count", "2026-07-01", 50, { company: "Acme Realty" }),
  row("orders.revenue", "2026-07-01", 20000, { company: "Bluebird Homes" }),
  row("orders.count", "2026-07-01", 40, { company: "Bluebird Homes" }),
  row("orders.revenue", "2026-07-01", 50000, { company: "__other__" }),
  // Product mix over trailing 3 months (May–Jul 2026)
  row("orders.revenue", "2026-05-01", 40000, { product: "Photos" }),
  row("orders.revenue", "2026-06-01", 30000, { product: "Photos" }),
  row("orders.revenue", "2026-07-01", 20000, { product: "Photos" }),
  row("orders.revenue", "2026-07-01", 30000, { product: "Video" }),
  row("orders.revenue", "2026-07-01", 15000, { product: "__other__" }),
  // Status mix
  row("orders.count", "2026-07-01", 400, { status: "completed" }),
  row("orders.count", "2026-07-01", 20, { status: "cancelled" }),
  // Agents
  row("orders.revenue", "2026-07-01", 25000, { agent: "Jane Park" }),
  row("orders.count", "2026-07-01", 60, { agent: "Jane Park" }),
  row("orders.revenue", "2026-07-01", 12000, { agent: "Bob Lee" }),
  row("orders.count", "2026-07-01", 30, { agent: "Bob Lee" }),
];

test("KPIs come from the current calendar month, undimensioned month-grain rows", () => {
  const p = computeSnapshot(FIXTURE, [source()], NOW);
  assert.equal(p.kpis.revenueThisMonth, 100000);
  assert.equal(p.kpis.ordersThisMonth, 250);
  assert.equal(p.kpis.avgOrderValue, 400);
  assert.equal(p.kpis.activeCustomers, 2); // Acme + Bluebird; __other__ is a bucket, not a customer
});

test("MoM deltas are (cur - prev) / prev", () => {
  const p = computeSnapshot(FIXTURE, [source()], NOW);
  assert.equal(p.kpis.revenueMoM, 0.25);
  assert.equal(p.kpis.ordersMoM, 0.25);
});

test("MoM is null when the previous month is 0 or missing", () => {
  const zeroPrev = [
    row("orders.revenue", "2026-07-01", 100000),
    row("orders.count", "2026-07-01", 250),
    row("orders.revenue", "2026-06-01", 0),
    // no orders.count row at all for 2026-06
  ];
  const p = computeSnapshot(zeroPrev, [source()], NOW);
  assert.equal(p.kpis.revenueMoM, null);
  assert.equal(p.kpis.ordersMoM, null);
});

test("trend covers exactly 13 months, oldest first, zero-filled", () => {
  const p = computeSnapshot(FIXTURE, [source()], NOW);
  assert.equal(p.trend.length, 13);
  assert.equal(p.trend[0].month, "2025-07");
  assert.equal(p.trend[12].month, "2026-07");
  assert.deepEqual(p.trend.find((t) => t.month === "2025-09"), {
    month: "2025-09",
    revenue: 152925,
    orders: 507,
  });
  assert.deepEqual(p.trend.find((t) => t.month === "2025-10"), {
    month: "2025-10",
    revenue: 0,
    orders: 0,
  });
  assert.equal(p.trend.some((t) => t.month === "2025-05"), false);
});

test("productMix sums trailing 3 months, sorted desc, __other__ appended last as 'Other'", () => {
  const p = computeSnapshot(FIXTURE, [source()], NOW);
  assert.deepEqual(p.productMix, [
    { name: "Photos", revenue: 90000 },
    { name: "Video", revenue: 30000 },
    { name: "Other", revenue: 15000 },
  ]);
});

test("statusMix and top lists exclude __other__ and sort by value desc", () => {
  const p = computeSnapshot(FIXTURE, [source()], NOW);
  assert.deepEqual(p.statusMix, [
    { name: "completed", count: 400 },
    { name: "cancelled", count: 20 },
  ]);
  assert.deepEqual(p.topCompanies, [
    { name: "Acme Realty", revenue: 30000, orders: 50 },
    { name: "Bluebird Homes", revenue: 20000, orders: 40 },
  ]);
  assert.deepEqual(p.topAgents, [
    { name: "Jane Park", revenue: 25000, orders: 60 },
    { name: "Bob Lee", revenue: 12000, orders: 30 },
  ]);
});

test("sources pass through with camelCase health fields", () => {
  const p = computeSnapshot(FIXTURE, [source({ status: "error", last_sync_error: "boom" })], NOW);
  assert.deepEqual(p.sources, [
    {
      id: "src-1",
      label: "Spiro — production",
      provider: "spiro",
      status: "error",
      lastSyncAt: "2026-07-15T09:00:00.000Z",
      lastSyncError: "boom",
    },
  ]);
});

test("empty warehouse produces a zeroed payload, never throws", () => {
  const p = computeSnapshot([], [], NOW);
  assert.equal(p.generatedAt, NOW.toISOString());
  assert.deepEqual(p.kpis, {
    revenueThisMonth: 0,
    ordersThisMonth: 0,
    avgOrderValue: 0,
    activeCustomers: 0,
    revenueMoM: null,
    ordersMoM: null,
  });
  assert.equal(p.trend.length, 13);
  assert.ok(p.trend.every((t) => t.revenue === 0 && t.orders === 0));
  assert.deepEqual(p.productMix, []);
  assert.deepEqual(p.statusMix, []);
  assert.deepEqual(p.topCompanies, []);
  assert.deepEqual(p.topAgents, []);
  assert.deepEqual(p.sources, []);
});

test("computeSnapshot seeds additive command-center fields (empty warehouse)", () => {
  const p = computeSnapshot([], [], NOW);
  assert.deepEqual(p.yoy, { revenueYoY: null, ordersYoY: null });
  assert.deepEqual(p.paceToGoal, { target: null, mtd: 0, projected: 0, fraction: 0, basis: "none" });
  assert.equal(p.tileSparks.revenue.length, 13);
  assert.equal(p.tileSparks.orders.length, 13);
  assert.equal(p.tileSparks.avgOrderValue.length, 13);
  assert.equal(p.tileSparks.activeCustomers.length, 13);
  assert.ok(p.tileSparks.revenue.every((v) => v === 0));
  assert.ok(p.tileSparks.orders.every((v) => v === 0));
});
