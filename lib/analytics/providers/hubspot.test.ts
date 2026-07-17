// lib/analytics/providers/hubspot.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hubspotAdapter } from "./hubspot";
import type { DataSourceRow, SourceCtx } from "@/lib/analytics/types";

function fakeCtx(): SourceCtx {
  const source: DataSourceRow = {
    id: "src-1",
    client_id: "client-1",
    kind: "rest",
    provider: "hubspot",
    label: "HubSpot",
    config: {},
    secret_enc: null,
    chat_tool_allowlist: [],
    status: "active",
    last_sync_at: null,
    last_sync_error: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  return { source, secret: "test-token" };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

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

test("sync() always declines as unsupported — order sync is a separate job", async () => {
  const r = await hubspotAdapter.sync(fakeCtx(), { from: "2026-01-01", to: "2026-01-31", backfill: false });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, "unsupported");
});

test("chatTools() returns none", async () => {
  assert.deepEqual(await hubspotAdapter.chatTools(fakeCtx()), []);
});

test("testConnection() over a 401 maps to auth", async () => {
  const r = await withStubbedFetch(async () => jsonResponse(401, {}), () => hubspotAdapter.testConnection(fakeCtx()));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, "auth");
});

test("testConnection() over a 200 succeeds", async () => {
  const r = await withStubbedFetch(async () => jsonResponse(200, { results: [] }), () => hubspotAdapter.testConnection(fakeCtx()));
  assert.equal(r.ok, true);
});

test("testConnection() with no secret returns a config error, no network call", async () => {
  const ctx: SourceCtx = { ...fakeCtx(), secret: null };
  const r = await hubspotAdapter.testConnection(ctx);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, "config");
});
