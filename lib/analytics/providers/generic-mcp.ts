// lib/analytics/providers/generic-mcp.ts
//
// Generic MCP source adapter. MCP sources are CHAT-ONLY in v1 (spec §4):
// arbitrary MCP tools cannot be auto-normalized into warehouse metrics, so
// sync() is unsupported and dashboard tiles come from REST adapters.
//
// Chat exposure is doubly gated: a tool must be BOTH annotated read-only by
// the server (readOnlyHint === true) AND admin-allowlisted in
// source.chat_tool_allowlist. Everything else is invisible to the model.

import type {
  ChatTool,
  ConnectionInfo,
  MetricRow,
  ProviderAdapter,
  Result,
  SourceCtx,
  SyncWindow,
} from "@/lib/analytics/types";
import { mcpCallTool, mcpListTools, type McpToolInfo } from "@/lib/analytics/mcp";

export function endpointFromConfig(config: Record<string, unknown>): string | null {
  const url = config.endpointUrl;
  return typeof url === "string" && url.trim().length > 0 ? url.trim() : null;
}

export function selectChatTools(tools: McpToolInfo[], allowlist: string[]): McpToolInfo[] {
  const allowed = new Set(allowlist);
  return tools.filter((t) => t.readOnly && allowed.has(t.name));
}

export const genericMcpAdapter: ProviderAdapter = {
  provider: "generic_mcp",

  async testConnection(ctx: SourceCtx): Promise<Result<{ info: ConnectionInfo }>> {
    const endpoint = endpointFromConfig(ctx.source.config);
    if (!endpoint) {
      return { ok: false, kind: "config", reason: "MCP source config is missing endpointUrl" };
    }
    const r = await mcpListTools(endpoint, ctx.secret);
    if (!r.ok) return r;
    const readOnlyCount = r.tools.filter((t) => t.readOnly).length;
    return {
      ok: true,
      info: {
        detail: `MCP server reachable — ${r.tools.length} tools discovered (${readOnlyCount} read-only)`,
        toolNames: r.tools.map((t) => t.name),
      },
    };
  },

  async sync(_ctx: SourceCtx, _window: SyncWindow): Promise<Result<{ rows: MetricRow[] }>> {
    return { ok: false, kind: "unsupported", reason: "MCP sources are chat-only in v1" };
  },

  async chatTools(ctx: SourceCtx): Promise<ChatTool[]> {
    const endpoint = endpointFromConfig(ctx.source.config);
    if (!endpoint) return [];
    const r = await mcpListTools(endpoint, ctx.secret);
    // Chat degrades gracefully when the server is down; health is surfaced
    // via testConnection and source status, not by breaking the chat panel.
    if (!r.ok) return [];
    return selectChatTools(r.tools, ctx.source.chat_tool_allowlist).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
      execute: async (input: Record<string, unknown>) => {
        const res = await mcpCallTool(endpoint, ctx.secret, t.name, input);
        return res.ok ? res.content : `MCP tool error (${res.kind}): ${res.reason}`;
      },
    }));
  },
};
