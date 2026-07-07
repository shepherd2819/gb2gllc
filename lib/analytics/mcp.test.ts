// lib/analytics/mcp.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MCP_CONTENT_CAP,
  extractTextContent,
  mapMcpError,
  mcpCallTool,
  mcpListTools,
  toMcpToolInfo,
  type McpClientLike,
} from "./mcp";

// ── Pure helpers ─────────────────────────────────────────────────────────────

test("toMcpToolInfo marks a tool read-only only when readOnlyHint is exactly true", () => {
  const base = { name: "t", inputSchema: { type: "object" } };
  assert.equal(toMcpToolInfo({ ...base, annotations: { readOnlyHint: true } }).readOnly, true);
  assert.equal(toMcpToolInfo({ ...base, annotations: { readOnlyHint: false } }).readOnly, false);
  assert.equal(toMcpToolInfo({ ...base, annotations: {} }).readOnly, false);
  assert.equal(toMcpToolInfo(base).readOnly, false);
});

test("toMcpToolInfo defaults a missing description to the empty string", () => {
  const info = toMcpToolInfo({ name: "t", inputSchema: { type: "object" } });
  assert.equal(info.description, "");
  assert.equal(info.name, "t");
  assert.deepEqual(info.inputSchema, { type: "object" });
});

test("extractTextContent joins only text parts and ignores other content types", () => {
  const content = [
    { type: "text", text: "line one" },
    { type: "image", data: "abc", mimeType: "image/png" },
    { type: "text", text: "line two" },
  ];
  assert.equal(extractTextContent(content), "line one\nline two");
});

test("extractTextContent returns empty string for non-array content", () => {
  assert.equal(extractTextContent(undefined), "");
  assert.equal(extractTextContent({ text: "x" }), "");
  assert.equal(extractTextContent("raw string"), "");
});

test("extractTextContent caps oversized results at MCP_CONTENT_CAP with a truncation marker", () => {
  const big = [{ type: "text", text: "x".repeat(MCP_CONTENT_CAP + 5000) }];
  const out = extractTextContent(big);
  assert.equal(out.length, MCP_CONTENT_CAP);
  assert.ok(out.endsWith("…[truncated]"));
});

test("mapMcpError classifies auth, network, config, and generic failures", () => {
  assert.equal(mapMcpError(new Error("HTTP 401 Unauthorized")).kind, "auth");
  assert.equal(mapMcpError(new Error("Forbidden")).kind, "auth");
  assert.equal(mapMcpError(new Error("Request timed out")).kind, "network");
  assert.equal(mapMcpError(new Error("fetch failed")).kind, "network");
  assert.equal(mapMcpError(new Error("connect ECONNREFUSED 127.0.0.1:443")).kind, "network");
  assert.equal(mapMcpError(new Error("Invalid URL")).kind, "config");
  assert.equal(mapMcpError(new Error("something exploded")).kind, "error");
  assert.equal(mapMcpError("plain string failure").kind, "error");
  assert.equal(mapMcpError(new Error("boom")).ok, false);
});

// ── Injected-client integration tests (offline, no network) ────────────────
// mcpListTools/mcpCallTool accept an optional client factory so we can drive
// the connect → operate → close lifecycle without a real transport.

function fakeFactory(client: McpClientLike, opts: { connectShouldReject?: unknown } = {}) {
  const calls: string[] = [];
  const closedClient: McpClientLike = {
    listTools: client.listTools,
    callTool: client.callTool,
    close: async () => {
      calls.push("close");
      await client.close();
    },
  };
  const factory = async (_endpointUrl: string, _secret: string | null) => {
    calls.push("connect");
    if (opts.connectShouldReject) throw opts.connectShouldReject;
    return closedClient;
  };
  return { factory, calls };
}

test("mcpListTools maps a successful tools/list into McpToolInfo[]", async () => {
  const { factory, calls } = fakeFactory({
    listTools: async () => ({
      tools: [
        { name: "search_orders", description: "Search orders", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
        { name: "delete_order", inputSchema: { type: "object" }, annotations: { readOnlyHint: false } },
      ],
    }),
    callTool: async () => ({ content: [] }),
    close: async () => {},
  });

  const result = await mcpListTools("https://client.example/mcp", "s3cr3t", factory);

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.tools.length, 2);
  assert.deepEqual(result.tools[0], {
    name: "search_orders",
    description: "Search orders",
    inputSchema: { type: "object" },
    readOnly: true,
  });
  assert.equal(result.tools[1].readOnly, false);
  assert.deepEqual(calls, ["connect", "close"]);
});

test("mcpCallTool maps a successful tools/call into joined+capped content", async () => {
  const { factory, calls } = fakeFactory({
    listTools: async () => ({ tools: [] }),
    callTool: async (params) => {
      assert.deepEqual(params, { name: "search_orders", arguments: { q: "june" } });
      return {
        content: [
          { type: "text", text: "row one" },
          { type: "text", text: "row two" },
        ],
      };
    },
    close: async () => {},
  });

  const result = await mcpCallTool("https://client.example/mcp", "s3cr3t", "search_orders", { q: "june" }, factory);

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.content, "row one\nrow two");
  assert.deepEqual(calls, ["connect", "close"]);
});

test("mcpCallTool maps an isError tool result to kind 'error' without throwing", async () => {
  const { factory, calls } = fakeFactory({
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({
      isError: true,
      content: [{ type: "text", text: "unknown tool argument 'q'" }],
    }),
    close: async () => {},
  });

  const result = await mcpCallTool("https://client.example/mcp", null, "search_orders", {}, factory);

  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.kind, "error");
  assert.equal(result.reason, "unknown tool argument 'q'");
  assert.deepEqual(calls, ["connect", "close"]);
});

test("mcpListTools maps a rejected connect to kind 'network' and never throws", async () => {
  const { factory, calls } = fakeFactory(
    {
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [] }),
      close: async () => {},
    },
    { connectShouldReject: new Error("fetch failed") },
  );

  const result = await mcpListTools("https://client.example/mcp", "s3cr3t", factory);

  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.kind, "network");
  // connect rejected before a client existed, so no close should be recorded.
  assert.deepEqual(calls, ["connect"]);
});

test("mcpListTools maps a rejected listTools call to kind 'auth' on 401-like errors, and still closes", async () => {
  const { factory, calls } = fakeFactory({
    listTools: async () => {
      throw new Error("HTTP 401 Unauthorized");
    },
    callTool: async () => ({ content: [] }),
    close: async () => {},
  });

  const result = await mcpListTools("https://client.example/mcp", "bad-secret", factory);

  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.kind, "auth");
  assert.deepEqual(calls, ["connect", "close"]);
});

test("mcpCallTool still closes the connection when callTool rejects", async () => {
  const { factory, calls } = fakeFactory({
    listTools: async () => ({ tools: [] }),
    callTool: async () => {
      throw new Error("Request timed out");
    },
    close: async () => {},
  });

  const result = await mcpCallTool("https://client.example/mcp", "s3cr3t", "search_orders", {}, factory);

  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.kind, "network");
  assert.deepEqual(calls, ["connect", "close"]);
});

test("close() failures are swallowed and never surface as a rejection or mask the original result", async () => {
  const { factory } = fakeFactory({
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
    close: async () => {
      throw new Error("close exploded");
    },
  });

  const result = await mcpCallTool("https://client.example/mcp", "s3cr3t", "search_orders", {}, factory);

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.content, "ok");
});
