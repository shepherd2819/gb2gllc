// lib/analytics/providers/spiro.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketsToMetricRows,
  bucketTopN,
  capJson,
  mapSpiroStatus,
  monthWindow,
  type SpiroBucket,
} from "./spiro";

// Verified live via Spiro's MCP proxy 2026-07-07: June 2026 = 286 orders / $100,054.30.
const JUNE_2026: SpiroBucket = {
  bucketStart: "2026-06-01",
  bucketEnd: "2026-06-30",
  orderCount: 286,
  orderTotal: 100054.3,
};

test("bucketsToMetricRows turns one undimensioned month bucket into count + revenue rows", () => {
  const rows = bucketsToMetricRows([JUNE_2026], "month");
  assert.equal(rows.length, 2);
  const count = rows.find((r) => r.metric === "orders.count");
  const revenue = rows.find((r) => r.metric === "orders.revenue");
  assert.ok(count, "expected an orders.count row");
  assert.ok(revenue, "expected an orders.revenue row");
  assert.equal(count.value, 286);
  assert.equal(revenue.value, 100054.3);
  assert.equal(count.grain, "month");
  assert.equal(count.period_start, "2026-06-01");
  assert.equal(count.period_end, "2026-06-30");
  assert.deepEqual(count.dimension, {});
});

test("bucketTopN keeps the top N groups by revenue and buckets the tail as __other__", () => {
  const buckets: SpiroBucket[] = [];
  for (let i = 0; i < 12; i++) {
    buckets.push({
      bucketStart: "2026-06-01",
      bucketEnd: "2026-06-30",
      orderCount: 12 - i,
      orderTotal: (12 - i) * 1000,
      group: `Company ${i + 1}`,
    });
  }
  const rows = bucketTopN(buckets, "company", "month", 10);
  const revenueRows = rows.filter((r) => r.metric === "orders.revenue");
  assert.equal(revenueRows.length, 11); // 10 named groups + 1 __other__
  const other = revenueRows.find((r) => r.dimension.company === "__other__");
  assert.ok(other, "expected an __other__ revenue bucket");
  assert.equal(other.value, 3000); // Company 11 (2000) + Company 12 (1000)
  const otherCount = rows.find(
    (r) => r.metric === "orders.count" && r.dimension.company === "__other__",
  );
  assert.ok(otherCount, "expected an __other__ count bucket");
  assert.equal(otherCount.value, 3); // 2 + 1
  assert.ok(
    revenueRows.some((r) => r.dimension.company === "Company 1" && r.value === 12000),
    "top group survives with its own name",
  );
});

test("bucketTopN ranks within each period independently and emits no __other__ when groups <= N", () => {
  const buckets: SpiroBucket[] = [
    { bucketStart: "2026-05-01", bucketEnd: "2026-05-31", orderCount: 5, orderTotal: 5000, group: "A" },
    { bucketStart: "2026-05-01", bucketEnd: "2026-05-31", orderCount: 2, orderTotal: 2000, group: "B" },
    { bucketStart: "2026-06-01", bucketEnd: "2026-06-30", orderCount: 9, orderTotal: 9000, group: "B" },
  ];
  const rows = bucketTopN(buckets, "company", "month", 10);
  assert.equal(rows.length, 6); // 3 buckets x 2 metrics, no __other__
  assert.ok(!rows.some((r) => r.dimension.company === "__other__"));
  const juneRevenue = rows.find(
    (r) => r.metric === "orders.revenue" && r.period_start === "2026-06-01",
  );
  assert.ok(juneRevenue);
  assert.deepEqual(juneRevenue.dimension, { company: "B" });
  assert.equal(juneRevenue.value, 9000);
});

test("monthWindow trails 13 months normally", () => {
  const w = monthWindow(new Date("2026-07-07T12:00:00Z"), false);
  assert.equal(w.from, "2025-07-01");
  assert.equal(w.to, "2026-07-07");
});

test("monthWindow trails 24 months on backfill", () => {
  const w = monthWindow(new Date("2026-07-07T12:00:00Z"), true);
  assert.equal(w.from, "2024-08-01");
  assert.equal(w.to, "2026-07-07");
});

test("mapSpiroStatus maps 401/403 to auth", () => {
  assert.equal(mapSpiroStatus(401), "auth");
  assert.equal(mapSpiroStatus(403), "auth");
});

test("mapSpiroStatus maps 5xx to network", () => {
  assert.equal(mapSpiroStatus(500), "network");
  assert.equal(mapSpiroStatus(502), "network");
  assert.equal(mapSpiroStatus(503), "network");
});

test("mapSpiroStatus maps other client errors to error", () => {
  assert.equal(mapSpiroStatus(404), "error");
  assert.equal(mapSpiroStatus(422), "error");
  assert.equal(mapSpiroStatus(429), "error");
});

test("capJson caps stringified payloads at 20000 chars with a truncation marker", () => {
  const out = capJson({ rows: "y".repeat(30000) });
  assert.equal(out.length, 20000);
  assert.ok(out.endsWith("…[truncated]"));
  assert.equal(capJson({ a: 1 }), '{"a":1}');
});
