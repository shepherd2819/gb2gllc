// lib/analytics/entity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEntitySeries, trailingMonthKeys } from "./entity";
import type { StoredMetric } from "./types";

function m(metric: string, period_start: string, value: number): StoredMetric {
  return {
    source_id: "s1",
    metric,
    grain: "month",
    period_start,
    period_end: period_start,
    dimension: { company: "Acme" },
    value,
  };
}

test("trailingMonthKeys: oldest→newest, count entries, ends at now's UTC month", () => {
  const keys = trailingMonthKeys(new Date("2026-07-15T12:00:00Z"), 13);
  assert.equal(keys.length, 13);
  assert.equal(keys[0], "2025-07");
  assert.equal(keys[12], "2026-07");
});

test("trailingMonthKeys: wraps the year boundary correctly", () => {
  const keys = trailingMonthKeys(new Date("2026-01-10T00:00:00Z"), 3);
  assert.deepEqual(keys, ["2025-11", "2025-12", "2026-01"]);
});

test("buildEntitySeries: empty rows → every month zero-filled, zero totals", () => {
  const months = ["2026-05", "2026-06", "2026-07"];
  const s = buildEntitySeries([], months);
  assert.deepEqual(s.months, [
    { month: "2026-05", revenue: 0, orders: 0 },
    { month: "2026-06", revenue: 0, orders: 0 },
    { month: "2026-07", revenue: 0, orders: 0 },
  ]);
  assert.deepEqual(s.totals, { revenue: 0, orders: 0 });
});

test("buildEntitySeries: revenue + count rows land in the right month + totals", () => {
  const months = ["2026-06", "2026-07"];
  const rows = [
    m("orders.revenue", "2026-06-01", 1000),
    m("orders.count", "2026-06-01", 10),
    m("orders.revenue", "2026-07-01", 2000),
    m("orders.count", "2026-07-01", 20),
  ];
  const s = buildEntitySeries(rows, months);
  assert.deepEqual(s.months, [
    { month: "2026-06", revenue: 1000, orders: 10 },
    { month: "2026-07", revenue: 2000, orders: 20 },
  ]);
  assert.deepEqual(s.totals, { revenue: 3000, orders: 30 });
});

test("buildEntitySeries: multiple rows in one month are summed", () => {
  const months = ["2026-07"];
  const rows = [
    m("orders.revenue", "2026-07-01", 500),
    m("orders.revenue", "2026-07-01", 250),
  ];
  const s = buildEntitySeries(rows, months);
  assert.equal(s.months[0].revenue, 750);
  assert.equal(s.totals.revenue, 750);
});

test("buildEntitySeries: rows outside the window and non-month grain are ignored", () => {
  const months = ["2026-07"];
  const rows: StoredMetric[] = [
    m("orders.revenue", "2020-01-01", 9999),                         // out of window
    { ...m("orders.revenue", "2026-07-01", 100), grain: "week" },     // wrong grain
    m("orders.revenue", "2026-07-01", 100),                          // counted
  ];
  const s = buildEntitySeries(rows, months);
  assert.equal(s.months[0].revenue, 100);
});
