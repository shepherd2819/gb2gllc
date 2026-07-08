// lib/analytics/providers/spiro.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketsToMetricRows,
  bucketTopN,
  capJson,
  mapSpiroStatus,
  monthWindow,
  spiroAdapter,
  type SpiroBucket,
} from "./spiro";
import type { DataSourceRow, SourceCtx } from "@/lib/analytics/types";

// ── HTTP integration test helpers ───────────────────────────────────────────
// spiroGet/summarize/spiroAdapter reach the network via the global `fetch`.
// These tests stub `global.fetch` per-test and always restore the original
// in a `finally` so no test can leak a stub into another test or hit the
// real network.

function fakeCtx(overrides: Partial<DataSourceRow["config"]> = {}): SourceCtx {
  const source: DataSourceRow = {
    id: "src-1",
    client_id: "client-1",
    kind: "rest",
    provider: "spiro",
    label: "Spiro",
    config: { baseUrl: "https://api.spiro.test", ...overrides },
    secret_enc: null,
    chat_tool_allowlist: [],
    status: "active",
    last_sync_at: null,
    last_sync_error: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  return { source, secret: "test-api-key" };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Runs `fn` with global.fetch replaced by `impl`, restoring the original
// fetch afterward even if `fn` throws.
async function withStubbedFetch<T>(
  impl: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = global.fetch;
  global.fetch = impl as typeof fetch;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
}

const AUTHORITATIVE_BODY = {
  data: [{ bucketStart: "2026-06-01", bucketEnd: "2026-06-30", orderCount: 286, orderTotal: 100054.3 }],
  meta: {},
};

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

// ── HTTP integration (offline, fetch stubbed) ───────────────────────────────

test("testConnection over a 401 response maps to Result kind 'auth'", async () => {
  const result = await withStubbedFetch(
    async () => jsonResponse(401, { error: "invalid api key" }),
    () => spiroAdapter.testConnection(fakeCtx()),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, "auth");
});

test("testConnection over a 500 response maps to Result kind 'network'", async () => {
  const result = await withStubbedFetch(
    async () => jsonResponse(500, { error: "boom" }),
    () => spiroAdapter.testConnection(fakeCtx()),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, "network");
});

test("testConnection over an ok response with the authoritative body succeeds and normalizes values", async () => {
  const result = await withStubbedFetch(
    async () => jsonResponse(200, AUTHORITATIVE_BODY),
    () => spiroAdapter.testConnection(fakeCtx()),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.info.detail, /286 orders/);
    assert.match(result.info.detail, /\$100,054\.3/);
  }
});

test("testConnection over an ok response with malformed (non-JSON) body returns a clean Err, not a throw", async () => {
  const result = await withStubbedFetch(
    async () =>
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    () => spiroAdapter.testConnection(fakeCtx()),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, "error");
    assert.match(result.reason, /non-JSON/);
  }
});

test("testConnection maps a throwing fetch() to Result kind 'network' (not a throw)", async () => {
  const result = await withStubbedFetch(
    async () => {
      throw new Error("connection reset");
    },
    () => spiroAdapter.testConnection(fakeCtx()),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, "network");
    assert.match(result.reason, /connection reset/);
  }
});

test("testConnection maps a throwing res.text() to Result kind 'network' (not a throw) — Finding 1 regression", async () => {
  const fakeRes = {
    ok: true,
    status: 200,
    text: async () => {
      throw new Error("stream aborted mid-body");
    },
  } as unknown as Response;
  const result = await withStubbedFetch(
    async () => fakeRes,
    () => spiroAdapter.testConnection(fakeCtx()),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, "network");
    assert.match(result.reason, /stream aborted mid-body/);
  }
});

test("spiroAdapter.sync happy path returns rows without throwing", async () => {
  const result = await withStubbedFetch(
    async () => jsonResponse(200, AUTHORITATIVE_BODY),
    () => spiroAdapter.sync(fakeCtx(), { from: "2026-06-01", to: "2026-07-07", backfill: false }),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.rows.length > 0, "expected sync to produce metric rows");
    assert.ok(result.rows.some((r) => r.metric === "orders.count"));
    assert.ok(result.rows.some((r) => r.metric === "orders.revenue"));
  }
});

test("spiroAdapter.sync skips a dimension whose groupBy the endpoint rejects (non-fatal) and still returns undimensioned rows", async () => {
  // Undimensioned month/week queries succeed (200); every grouped (dimension)
  // query 400s — sync must NOT abort: it returns the core undimensioned rows,
  // just with no dimensioned top-list rows.
  const result = await withStubbedFetch(
    async (url: unknown) =>
      String(url).includes("groupBy")
        ? jsonResponse(400, { error: "groupBy not supported" })
        : jsonResponse(200, AUTHORITATIVE_BODY),
    () => spiroAdapter.sync(fakeCtx(), { from: "2026-06-01", to: "2026-07-07", backfill: false }),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    // Core undimensioned rows still present…
    assert.ok(result.rows.some((r) => r.metric === "orders.count"), "expected undimensioned count rows");
    assert.ok(result.rows.some((r) => r.metric === "orders.revenue"), "expected undimensioned revenue rows");
    // …and zero dimensioned rows (every groupBy failed → skipped, not fatal).
    assert.ok(
      result.rows.every((r) => Object.keys(r.dimension).length === 0),
      "expected no dimensioned rows when every groupBy query fails",
    );
  }
});

test("spiroAdapter.sync still fails hard when the undimensioned (core) query fails", async () => {
  // If the CORE undimensioned month query fails, the whole sync is a genuine
  // failure (unlike a best-effort dimension) — must return the Err.
  const result = await withStubbedFetch(
    async () => jsonResponse(500, { error: "boom" }),
    () => spiroAdapter.sync(fakeCtx(), { from: "2026-06-01", to: "2026-07-07", backfill: false }),
  );
  assert.equal(result.ok, false);
});

test("chat tool search_orders execute() happy path returns JSON text without throwing", async () => {
  const result = await withStubbedFetch(
    async () => jsonResponse(200, { data: [{ id: "order-1" }] }),
    async () => {
      const tools = await spiroAdapter.chatTools(fakeCtx());
      const searchOrders = tools.find((t) => t.name === "search_orders");
      assert.ok(searchOrders, "expected a search_orders chat tool");
      return searchOrders!.execute({ query: "123 Main St" });
    },
  );
  assert.equal(typeof result, "string");
  assert.match(result, /order-1/);
});
