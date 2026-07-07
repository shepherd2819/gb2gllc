// lib/analytics/providers/generic-mcp.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DataSourceRow, SourceCtx } from "@/lib/analytics/types";
import type { McpToolInfo } from "@/lib/analytics/mcp";
import { endpointFromConfig, genericMcpAdapter, selectChatTools } from "./generic-mcp";

function makeCtx(overrides: Partial<DataSourceRow> = {}): SourceCtx {
  const source: DataSourceRow = {
    id: "src-1",
    client_id: "client-1",
    kind: "mcp",
    provider: "generic_mcp",
    label: "Spiro MCP",
    config: { endpointUrl: "https://mcp.example.com/mcp" },
    secret_enc: null,
    chat_tool_allowlist: [],
    status: "active",
    last_sync_at: null,
    last_sync_error: null,
    created_at: "2026-07-07T00:00:00Z",
    updated_at: "2026-07-07T00:00:00Z",
    ...overrides,
  };
  return { source, secret: null };
}

const TOOLS: McpToolInfo[] = [
  { name: "search_orders", description: "search", inputSchema: { type: "object" }, readOnly: true },
  { name: "get_order", description: "get", inputSchema: { type: "object" }, readOnly: true },
  { name: "delete_order", description: "DANGER", inputSchema: { type: "object" }, readOnly: false },
];

test("selectChatTools keeps only tools that are BOTH allowlisted and read-only", () => {
  const picked = selectChatTools(TOOLS, ["search_orders", "delete_order"]);
  assert.deepEqual(picked.map((t) => t.name), ["search_orders"]);
});

test("selectChatTools returns nothing when the allowlist is empty", () => {
  assert.deepEqual(selectChatTools(TOOLS, []), []);
});

test("selectChatTools excludes non-read-only tools even when explicitly allowlisted", () => {
  assert.deepEqual(selectChatTools(TOOLS, ["delete_order"]), []);
});

test("sync is unsupported for generic MCP sources in v1", async () => {
  const r = await genericMcpAdapter.sync(makeCtx(), {
    from: "2026-05-01",
    to: "2026-07-07",
    backfill: false,
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.kind, "unsupported");
    assert.equal(r.reason, "MCP sources are chat-only in v1");
  }
});

test("endpointFromConfig requires a non-empty string endpointUrl", () => {
  assert.equal(
    endpointFromConfig({ endpointUrl: "https://mcp.example.com/mcp" }),
    "https://mcp.example.com/mcp",
  );
  assert.equal(endpointFromConfig({ endpointUrl: "  " }), null);
  assert.equal(endpointFromConfig({}), null);
  assert.equal(endpointFromConfig({ endpointUrl: 42 }), null);
});

test("testConnection fails with kind config when endpointUrl is missing", async () => {
  const r = await genericMcpAdapter.testConnection(makeCtx({ config: {} }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.kind, "config");
});

test("chatTools returns [] (no throw) when endpointUrl is missing", async () => {
  const tools = await genericMcpAdapter.chatTools(makeCtx({ config: {} }));
  assert.deepEqual(tools, []);
});

// Beyond the "endpointUrl absent" local guard above: testConnection must also
// pass through a genuine Err surfaced by mcpListTools itself once an
// endpoint is present. A malformed URL fails synchronously inside the SDK
// transport (new URL(...) throws) before any real network I/O, so this stays
// offline and deterministic while still exercising the `if (!r.ok) return r`
// passthrough line — a different code path than the config-missing case.
test("testConnection passes through an Err raised by mcpListTools (not just the local endpointUrl guard)", async () => {
  const r = await genericMcpAdapter.testConnection(makeCtx({ config: { endpointUrl: "not a url" } }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.kind, "config");
    assert.match(r.reason, /Invalid MCP endpoint URL/);
  }
});
