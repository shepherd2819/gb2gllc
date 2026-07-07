// lib/analytics/store.test.ts
// Pure builders for lib/analytics/store.ts. The DB-touching wrappers in
// store.ts stay thin and untested (repo convention); importing them here
// would pull in @/lib/supabase, which throws at import time without env.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMetricUpsertRows, mapMetricRow, mapSourceRow, startOfUtcDayIso } from "./store-builders";
import type { MetricRow } from "./types";

const baseSourceRow: Record<string, unknown> = {
  id: "s1",
  client_id: "c1",
  kind: "rest",
  provider: "spiro",
  label: "Spiro — production",
  config: { base_url: "https://api.spiro.media" },
  secret_enc: "v1:aaaa:bbbb:cccc",
  chat_tool_allowlist: ["search_orders"],
  status: "active",
  last_sync_at: "2026-07-07T05:00:00Z",
  last_sync_error: null,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-07T05:00:00Z",
};

test("mapSourceRow maps a full row faithfully", () => {
  const mapped = mapSourceRow(baseSourceRow);
  assert.equal(mapped.id, "s1");
  assert.equal(mapped.client_id, "c1");
  assert.equal(mapped.kind, "rest");
  assert.equal(mapped.provider, "spiro");
  assert.equal(mapped.label, "Spiro — production");
  assert.deepEqual(mapped.config, { base_url: "https://api.spiro.media" });
  assert.equal(mapped.secret_enc, "v1:aaaa:bbbb:cccc");
  assert.deepEqual(mapped.chat_tool_allowlist, ["search_orders"]);
  assert.equal(mapped.status, "active");
  assert.equal(mapped.last_sync_error, null);
});

test("mapSourceRow defaults chat_tool_allowlist to [] and config to {} when null", () => {
  const mapped = mapSourceRow({ ...baseSourceRow, chat_tool_allowlist: null, config: null, secret_enc: null });
  assert.deepEqual(mapped.chat_tool_allowlist, []);
  assert.deepEqual(mapped.config, {});
  assert.equal(mapped.secret_enc, null);
});

test("mapSourceRow drops non-string allowlist entries", () => {
  const mapped = mapSourceRow({ ...baseSourceRow, chat_tool_allowlist: ["search_orders", 42, null, "top_companies"] });
  assert.deepEqual(mapped.chat_tool_allowlist, ["search_orders", "top_companies"]);
});

test("buildMetricUpsertRows computes dimension_key and stamps client/source/synced_at", () => {
  const rows: MetricRow[] = [
    {
      metric: "orders.revenue",
      grain: "month",
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      dimension: { product: "Photos", company: "Acme" },
      value: 100054.3,
    },
    {
      metric: "orders.count",
      grain: "month",
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      dimension: {},
      value: 286,
    },
  ];
  const out = buildMetricUpsertRows("c1", "s1", rows, "2026-07-07T05:00:00.000Z");
  assert.equal(out.length, 2);
  assert.equal(out[0].dimension_key, "company=Acme|product=Photos");
  assert.equal(out[1].dimension_key, "");
  assert.equal(out[0].client_id, "c1");
  assert.equal(out[0].source_id, "s1");
  assert.equal(out[0].synced_at, "2026-07-07T05:00:00.000Z");
  assert.equal(out[0].value, 100054.3);
  assert.deepEqual(out[0].dimension, { product: "Photos", company: "Acme" });
});

test("mapMetricRow coerces NUMERIC-as-string value and null dimension", () => {
  const m = mapMetricRow({
    source_id: "s1",
    metric: "orders.revenue",
    grain: "month",
    period_start: "2026-06-01",
    period_end: "2026-06-30",
    dimension: null,
    value: "100054.30", // PostgREST returns NUMERIC as a string
  });
  assert.equal(m.value, 100054.3);
  assert.deepEqual(m.dimension, {});
  assert.equal(m.grain, "month");
});

test("startOfUtcDayIso floors to UTC midnight", () => {
  assert.equal(startOfUtcDayIso(new Date("2026-07-07T18:23:45.678Z")), "2026-07-07T00:00:00.000Z");
});
