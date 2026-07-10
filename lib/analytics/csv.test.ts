// lib/analytics/csv.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv, buildExportRows, EXPORT_TABLES } from "./csv";
import type { SnapshotPayload } from "./snapshot";

// ── toCsv quoting matrix (RFC 4180) ──────────────────────────────

test("toCsv joins fields with commas and records with CRLF", () => {
  const out = toCsv(["a", "b"], [["1", "2"], ["3", "4"]]);
  assert.equal(out, "a,b\r\n1,2\r\n3,4\r\n");
});

test("toCsv quotes fields containing commas", () => {
  const out = toCsv(["name"], [["Acme, Inc."]]);
  assert.equal(out, "name\r\n\"Acme, Inc.\"\r\n");
});

test("toCsv quotes fields containing quotes and doubles the quotes", () => {
  const out = toCsv(["name"], [['She said "hi"']]);
  assert.equal(out, 'name\r\n"She said ""hi"""\r\n');
});

test("toCsv quotes fields containing LF or CR", () => {
  assert.equal(toCsv(["n"], [["line1\nline2"]]), 'n\r\n"line1\nline2"\r\n');
  assert.equal(toCsv(["n"], [["line1\r\nline2"]]), 'n\r\n"line1\r\nline2"\r\n');
});

test("toCsv renders null as an empty field and numbers via String()", () => {
  const out = toCsv(["a", "b", "c"], [[null, 42, 3.5]]);
  assert.equal(out, "a,b,c\r\n,42,3.5\r\n");
});

test("toCsv quotes headers that need it too", () => {
  const out = toCsv(['weird,"header"'], [["x"]]);
  assert.equal(out, '"weird,""header"""\r\nx\r\n');
});

// ── buildExportRows: snapshot payload → table rows ───────────────

const payload: SnapshotPayload = {
  generatedAt: "2026-07-07T05:00:00.000Z",
  kpis: {
    revenueThisMonth: 100054.3,
    ordersThisMonth: 286,
    avgOrderValue: 349.84,
    activeCustomers: 41,
    revenueMoM: 0.05,
    ordersMoM: -0.02,
  },
  trend: [
    { month: "2026-05", revenue: 98000.5, orders: 270 },
    { month: "2026-06", revenue: 100054.3, orders: 286 },
  ],
  productMix: [{ name: "Photos, HDR", revenue: 60000 }],
  statusMix: [{ name: "completed", count: 250 }],
  topCompanies: [{ name: "Acme, Realty", revenue: 12000, orders: 30 }],
  topAgents: [{ name: 'Jo "Speedy" Ray', revenue: 9000, orders: 22 }],
  yoy: { revenueYoY: null, ordersYoY: null },
  paceToGoal: { target: null, mtd: 0, projected: 0, fraction: 0, basis: "none" },
  tileSparks: { revenue: [], orders: [], avgOrderValue: [], activeCustomers: [] },
  sources: [
    {
      id: "src-1",
      label: "Spiro — production",
      provider: "spiro",
      status: "active",
      lastSyncAt: "2026-07-07T05:00:00.000Z",
      lastSyncError: null,
    },
  ],
};

test("buildExportRows(trend) maps month/revenue/orders", () => {
  const built = buildExportRows(payload, "trend");
  assert.ok(built);
  assert.deepEqual(built.headers, ["month", "revenue", "orders"]);
  assert.deepEqual(built.rows, [
    ["2026-05", 98000.5, 270],
    ["2026-06", 100054.3, 286],
  ]);
});

test("buildExportRows(productMix) maps product/revenue", () => {
  const built = buildExportRows(payload, "productMix");
  assert.ok(built);
  assert.deepEqual(built.headers, ["product", "revenue"]);
  assert.deepEqual(built.rows, [["Photos, HDR", 60000]]);
});

test("buildExportRows(statusMix) maps status/count", () => {
  const built = buildExportRows(payload, "statusMix");
  assert.ok(built);
  assert.deepEqual(built.headers, ["status", "count"]);
  assert.deepEqual(built.rows, [["completed", 250]]);
});

test("buildExportRows(topCompanies) maps company/revenue/orders", () => {
  const built = buildExportRows(payload, "topCompanies");
  assert.ok(built);
  assert.deepEqual(built.headers, ["company", "revenue", "orders"]);
  assert.deepEqual(built.rows, [["Acme, Realty", 12000, 30]]);
});

test("buildExportRows(topAgents) maps agent/revenue/orders", () => {
  const built = buildExportRows(payload, "topAgents");
  assert.ok(built);
  assert.deepEqual(built.headers, ["agent", "revenue", "orders"]);
  assert.deepEqual(built.rows, [['Jo "Speedy" Ray', 9000, 22]]);
});

test("buildExportRows returns null for unknown tables", () => {
  assert.equal(buildExportRows(payload, "kpis"), null);
  assert.equal(buildExportRows(payload, ""), null);
  assert.equal(buildExportRows(payload, "TREND"), null);
});

test("EXPORT_TABLES lists exactly the five supported tables and each round-trips through toCsv", () => {
  assert.deepEqual([...EXPORT_TABLES], ["trend", "productMix", "statusMix", "topCompanies", "topAgents"]);
  for (const table of EXPORT_TABLES) {
    const built = buildExportRows(payload, table);
    assert.ok(built, `expected rows for ${table}`);
    const csv = toCsv(built.headers, built.rows);
    assert.ok(csv.endsWith("\r\n"));
    // quoted comma-bearing names must not add columns
    assert.equal(csv.split("\r\n")[0].split(",").length, built.headers.length);
  }
});
