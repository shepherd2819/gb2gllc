// lib/analytics/providers/spiro-mcp.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DataSourceRow, Result, SourceCtx } from "@/lib/analytics/types";
import { monthWindow } from "./spiro";
import {
  spiroMcpAdapter,
  spiroMcpChatTools,
  spiroMcpSync,
  spiroMcpTestConnection,
  type SummarizeCaller,
} from "./spiro-mcp";

// ── Offline caller stubs ─────────────────────────────────────────────────────
// spiroMcpTestConnection/spiroMcpSync/spiroMcpChatTools all take an optional
// SummarizeCaller so these tests never touch mcpCallTool / the network.

function fakeCtx(overrides: Partial<DataSourceRow> = {}): SourceCtx {
  const source: DataSourceRow = {
    id: "src-1",
    client_id: "client-1",
    kind: "mcp",
    provider: "spiro_mcp",
    label: "Spiro MCP",
    config: { endpointUrl: "https://mcp.spiro.test/mcp" },
    secret_enc: null,
    chat_tool_allowlist: [],
    status: "active",
    last_sync_at: null,
    last_sync_error: null,
    created_at: "2026-07-07T00:00:00Z",
    updated_at: "2026-07-07T00:00:00Z",
    ...overrides,
  };
  return { source, secret: "test-bearer-token" };
}

const JUNE_BUCKET = { bucketStart: "2026-06-01", bucketEnd: "2026-06-30", orderCount: 286, orderTotal: 100054.3 };

// Records every (name, args) call so tests can assert on tool-call shape.
function recordingCaller(
  impl: (name: string, args: Record<string, unknown>) => Promise<Result<{ content: string }>>,
): { caller: SummarizeCaller; calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const caller: SummarizeCaller = async (name, args) => {
    calls.push({ name, args });
    return impl(name, args);
  };
  return { caller, calls };
}

function okContent(body: unknown): Result<{ content: string }> {
  return { ok: true, content: JSON.stringify(body) };
}

// ── sync ─────────────────────────────────────────────────────────────────────

test("spiroMcpSync happy path: undimensioned month bucket produces orders.count and orders.revenue rows", async () => {
  const { caller } = recordingCaller(async () => okContent({ data: [JUNE_BUCKET] }));
  const result = await spiroMcpSync(fakeCtx(), { from: "2026-06-01", to: "2026-07-07", backfill: false }, caller);

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  const count = result.rows.find((r) => r.metric === "orders.count" && r.grain === "month");
  const revenue = result.rows.find((r) => r.metric === "orders.revenue" && r.grain === "month");
  assert.ok(count, "expected an orders.count month row");
  assert.ok(revenue, "expected an orders.revenue month row");
  assert.equal(count!.value, 286);
  assert.equal(revenue!.value, 100054.3);
  assert.deepEqual(count!.dimension, {}, "undimensioned — no per-entity filter queries in this pass");
});

test("spiroMcpSync calls summarize_spiro_reporting_orders with span:month then span:week", async () => {
  const { caller, calls } = recordingCaller(async () => okContent({ data: [JUNE_BUCKET] }));
  await spiroMcpSync(fakeCtx(), { from: "2026-06-01", to: "2026-07-07", backfill: false }, caller);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, "summarize_spiro_reporting_orders");
  assert.equal(calls[0].args.span, "month");
  assert.equal(calls[1].name, "summarize_spiro_reporting_orders");
  assert.equal(calls[1].args.span, "week");
  assert.equal(calls[1].args.from, "2026-06-01");
  assert.equal(calls[1].args.to, "2026-07-07");
});

test("spiroMcpSync is fatal when the core undimensioned month query errors", async () => {
  const { caller } = recordingCaller(async () => ({ ok: false, kind: "network", reason: "MCP network failure" }));
  const result = await spiroMcpSync(fakeCtx(), { from: "2026-06-01", to: "2026-07-07", backfill: false }, caller);

  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.kind, "network");
});

test("spiroMcpSync maps non-JSON tool content to a clean Err, never throws", async () => {
  const { caller } = recordingCaller(async () => ({ ok: true, content: "<html>not json</html>" }));
  const result = await spiroMcpSync(fakeCtx(), { from: "2026-06-01", to: "2026-07-07", backfill: false }, caller);

  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.kind, "error");
  assert.match(result.reason, /non-JSON/);
});

test("spiroMcpSync maps a response missing data[] to a clean Err", async () => {
  const { caller } = recordingCaller(async () => okContent({ meta: {} }));
  const result = await spiroMcpSync(fakeCtx(), { from: "2026-06-01", to: "2026-07-07", backfill: false }, caller);

  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.kind, "error");
  assert.match(result.reason, /data\[\]/);
});

test("spiroMcpSync fails cleanly (config, not throw) when endpointUrl is missing and no caller is injected", async () => {
  const ctx = fakeCtx({ config: {} });
  const result = await spiroMcpAdapter.sync(ctx, { from: "2026-06-01", to: "2026-07-07", backfill: false });

  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.kind, "config");
});

// ── testConnection ───────────────────────────────────────────────────────────

test("spiroMcpTestConnection happy path returns ok with a detail mentioning the order count", async () => {
  const { caller, calls } = recordingCaller(async () => okContent({ data: [JUNE_BUCKET] }));
  const result = await spiroMcpTestConnection(fakeCtx(), caller);

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.match(result.info.detail, /286 orders/);
  assert.match(result.info.detail, /\$100,054\.3/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.span, "month");
});

test("spiroMcpTestConnection handles an empty (no-orders-yet) bucket set without throwing", async () => {
  const { caller } = recordingCaller(async () => okContent({ data: [] }));
  const result = await spiroMcpTestConnection(fakeCtx(), caller);

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.match(result.info.detail, /no orders yet/);
});

test("spiroMcpTestConnection passes through an Err from the caller (e.g. auth failure)", async () => {
  const { caller } = recordingCaller(async () => ({ ok: false, kind: "auth", reason: "MCP auth failed" }));
  const result = await spiroMcpTestConnection(fakeCtx(), caller);

  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.kind, "auth");
});

// ── chatTools ────────────────────────────────────────────────────────────────

test("chatTools exposes spiro_reporting_summary and search_spiro_orders", async () => {
  const { caller } = recordingCaller(async () => okContent({ data: [JUNE_BUCKET] }));
  const tools = await spiroMcpChatTools(fakeCtx(), caller);
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["search_spiro_orders", "spiro_reporting_summary"],
  );
});

test("spiro_reporting_summary execute() calls the MCP tool and returns capped JSON text, never throws", async () => {
  const { caller, calls } = recordingCaller(async () => okContent({ data: [JUNE_BUCKET] }));
  const tools = await spiroMcpChatTools(fakeCtx(), caller);
  const summary = tools.find((t) => t.name === "spiro_reporting_summary")!;
  const out = await summary.execute({ from: "2026-06-01", to: "2026-06-30", span: "month" });

  assert.equal(typeof out, "string");
  assert.match(out, /orderCount/);
  assert.equal(calls[0].name, "summarize_spiro_reporting_orders");
  assert.equal(calls[0].args.span, "month");
});

test("spiro_reporting_summary execute() reports a validation error string (not a throw) when from/to are missing", async () => {
  const { caller } = recordingCaller(async () => okContent({ data: [] }));
  const tools = await spiroMcpChatTools(fakeCtx(), caller);
  const summary = tools.find((t) => t.name === "spiro_reporting_summary")!;
  const out = await summary.execute({});

  assert.match(out, /from and to.*required/);
});

test("search_spiro_orders execute() happy path returns JSON text without throwing", async () => {
  const { caller } = recordingCaller(async () => okContent({ data: [{ id: "order-1" }] }));
  const tools = await spiroMcpChatTools(fakeCtx(), caller);
  const search = tools.find((t) => t.name === "search_spiro_orders")!;
  const out = await search.execute({ query: "123 Main St" });

  assert.equal(typeof out, "string");
  assert.match(out, /order-1/);
});

test("search_spiro_orders execute() surfaces a caller Err as a string, never throws", async () => {
  const { caller } = recordingCaller(async () => ({ ok: false, kind: "error", reason: "unknown tool argument" }));
  const tools = await spiroMcpChatTools(fakeCtx(), caller);
  const search = tools.find((t) => t.name === "search_spiro_orders")!;
  const out = await search.execute({ query: "123 Main St" });

  assert.equal(typeof out, "string");
  assert.match(out, /unknown tool argument/);
});

// ── window math (shared with spiro.ts) ──────────────────────────────────────

test("spiroMcpSync's month window trails 13 months normally, 24 on backfill (via monthWindow)", () => {
  const normal = monthWindow(new Date("2026-07-07T12:00:00Z"), false);
  assert.equal(normal.from, "2025-07-01");
  assert.equal(normal.to, "2026-07-07");

  const backfilled = monthWindow(new Date("2026-07-07T12:00:00Z"), true);
  assert.equal(backfilled.from, "2024-08-01");
  assert.equal(backfilled.to, "2026-07-07");
});

test("spiroMcpSync requests 24 months of span:month data on backfill (integration through the caller)", async () => {
  const { caller, calls } = recordingCaller(async () => okContent({ data: [JUNE_BUCKET] }));
  await spiroMcpSync(fakeCtx(), { from: "2026-06-01", to: "2026-07-07", backfill: true }, caller);

  const expected = monthWindow(new Date(), true);
  assert.equal(calls[0].args.from, expected.from);
  assert.equal(calls[0].args.to, expected.to);
});

// ── registry wiring ──────────────────────────────────────────────────────────

test("spiroMcpAdapter identifies itself with provider 'spiro_mcp'", () => {
  assert.equal(spiroMcpAdapter.provider, "spiro_mcp");
});
