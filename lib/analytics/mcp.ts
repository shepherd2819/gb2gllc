// lib/analytics/mcp.ts
//
// The single MCP transport module (spec §4). Streamable HTTP only,
// Authorization: Bearer <decrypted secret>, 15s per-call timeout, result-size
// cap, discriminated-union returns, connection closed in finally. No retries
// in v1. We run our OWN client (not the Anthropic Messages API MCP connector)
// so every tool call flows through our chat loop → full audit trail,
// per-client scoping, and no requirement that client servers be reachable
// from Anthropic's infra.
//
// SDK import paths verified against node_modules/@modelcontextprotocol/sdk
// 1.29.0 (exports map "./*" → dist/esm/*).
//
// TESTABILITY: mcpListTools/mcpCallTool take an optional McpClientFactory
// (defaulting to the real SDK Client+StreamableHTTPClientTransport) so tests
// can inject a fake client and exercise the connect/operate/close lifecycle
// — including rejected calls and close() failures — fully offline. See
// mcp.test.ts.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Err, Result } from "@/lib/analytics/types";

export type McpToolInfo = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
};

export const MCP_CALL_TIMEOUT_MS = 15_000;
export const MCP_CONTENT_CAP = 20_000;

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

// The subset of the SDK's tools/list entry we depend on.
export type RawMcpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
};

export function toMcpToolInfo(tool: RawMcpTool): McpToolInfo {
  return {
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema,
    readOnly: tool.annotations?.readOnlyHint === true,
  };
}

export function extractTextContent(content: unknown, cap = MCP_CONTENT_CAP): string {
  if (!Array.isArray(content)) return "";
  const text = content
    .filter(
      (p): p is { type: "text"; text: string } =>
        typeof p === "object" &&
        p !== null &&
        (p as { type?: unknown }).type === "text" &&
        typeof (p as { text?: unknown }).text === "string",
    )
    .map((p) => p.text)
    .join("\n");
  if (text.length <= cap) return text;
  return text.slice(0, cap - 12) + "…[truncated]";
}

export function mapMcpError(e: unknown): Err {
  const msg = e instanceof Error ? e.message : String(e);
  if (/invalid url/i.test(msg)) {
    return { ok: false, kind: "config", reason: `Invalid MCP endpoint URL: ${msg.slice(0, 200)}` };
  }
  if (/\b401\b|\b403\b|unauthorized|forbidden|authentication/i.test(msg)) {
    return { ok: false, kind: "auth", reason: `MCP auth failed: ${msg.slice(0, 200)}` };
  }
  if (/timeout|timed out|fetch failed|network|econnrefused|enotfound|socket/i.test(msg)) {
    return { ok: false, kind: "network", reason: `MCP network failure: ${msg.slice(0, 200)}` };
  }
  return { ok: false, kind: "error", reason: `MCP error: ${msg.slice(0, 200)}` };
}

// ── Transport ───────────────────────────────────────────────────────────────

// The subset of the SDK's Client surface mcpListTools/mcpCallTool depend on.
// Matches Client.listTools / Client.callTool / Client.close (see
// @modelcontextprotocol/sdk/dist/esm/client/index.d.ts) structurally, so the
// real Client satisfies this type with no adapter — and tests can supply a
// plain object instead of standing up a real transport.
export type McpClientLike = {
  listTools: (
    params?: Record<string, unknown>,
    options?: { timeout?: number },
  ) => Promise<{ tools: RawMcpTool[] }>;
  callTool: (
    params: { name: string; arguments: Record<string, unknown> },
    resultSchema?: unknown,
    options?: { timeout?: number },
  ) => Promise<{ content?: unknown; isError?: boolean }>;
  close: () => Promise<void>;
};

export type McpClientFactory = (endpointUrl: string, secret: string | null) => Promise<McpClientLike>;

async function defaultClientFactory(endpointUrl: string, secret: string | null): Promise<McpClientLike> {
  const transport = new StreamableHTTPClientTransport(new URL(endpointUrl), {
    requestInit: secret ? { headers: { Authorization: `Bearer ${secret}` } } : undefined,
  });
  const client = new Client({ name: "gb2g-analytics", version: "1.0.0" });
  await client.connect(transport, { timeout: MCP_CALL_TIMEOUT_MS });
  return client as unknown as McpClientLike;
}

// Connects, runs `fn` against the live client, and closes the connection in
// a finally — whether `fn` resolves, returns an Err, or the connect/fn call
// rejects. `fn` itself returns a Result so it can hand back typed Err values
// (e.g. a tool's isError response) without throwing; genuine rejections
// (connect failures, transport errors) are caught here and mapped once.
async function runWithClient<T>(
  endpointUrl: string,
  secret: string | null,
  fn: (client: McpClientLike) => Promise<Result<T>>,
  factory: McpClientFactory = defaultClientFactory,
): Promise<Result<T>> {
  let client: McpClientLike | null = null;
  try {
    client = await factory(endpointUrl, secret);
    return await fn(client);
  } catch (e) {
    return mapMcpError(e);
  } finally {
    if (client) await client.close().catch(() => undefined);
  }
}

export async function mcpListTools(
  endpointUrl: string,
  secret: string | null,
  factory: McpClientFactory = defaultClientFactory,
): Promise<Result<{ tools: McpToolInfo[] }>> {
  return runWithClient<{ tools: McpToolInfo[] }>(
    endpointUrl,
    secret,
    async (client) => {
      const res = await client.listTools(undefined, { timeout: MCP_CALL_TIMEOUT_MS });
      return { ok: true, tools: res.tools.map((t) => toMcpToolInfo(t)) };
    },
    factory,
  );
}

export async function mcpCallTool(
  endpointUrl: string,
  secret: string | null,
  name: string,
  args: Record<string, unknown>,
  factory: McpClientFactory = defaultClientFactory,
): Promise<Result<{ content: string }>> {
  return runWithClient<{ content: string }>(
    endpointUrl,
    secret,
    async (client) => {
      const res = await client.callTool({ name, arguments: args }, undefined, {
        timeout: MCP_CALL_TIMEOUT_MS,
      });
      if (res.isError) {
        const detail = extractTextContent(res.content, 500);
        return { ok: false, kind: "error", reason: detail || `MCP tool ${name} reported an error` };
      }
      return { ok: true, content: extractTextContent(res.content) };
    },
    factory,
  );
}
