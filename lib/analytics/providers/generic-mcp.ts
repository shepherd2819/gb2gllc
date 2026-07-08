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

// authMode "oauth" sources have no static ctx.secret — the bearer comes from
// the stored refresh-token-backed access token instead (lib/analytics/
// oauth.ts's getValidAccessToken). That module transitively imports
// @/lib/supabase (via store.ts), which throws at import time without
// Supabase env vars set (see store.test.ts's header comment) — so it's
// loaded with a DYNAMIC import, only when an OAuth-mode source is actually
// seen, keeping this file's offline tests (which never construct
// authMode:"oauth" fixtures) free of that dependency.
async function resolveBearer(ctx: SourceCtx): Promise<Result<{ bearer: string | null }>> {
  if (ctx.source.config.authMode !== "oauth") {
    return { ok: true, bearer: ctx.secret };
  }
  const { getValidAccessToken } = await import("@/lib/analytics/oauth");
  const r = await getValidAccessToken(ctx.source);
  if (!r.ok) return r;
  return { ok: true, bearer: r.accessToken };
}

export const genericMcpAdapter: ProviderAdapter = {
  provider: "generic_mcp",

  async testConnection(ctx: SourceCtx): Promise<Result<{ info: ConnectionInfo }>> {
    const endpoint = endpointFromConfig(ctx.source.config);
    if (!endpoint) {
      return { ok: false, kind: "config", reason: "MCP source config is missing endpointUrl" };
    }
    const bearer = await resolveBearer(ctx);
    if (!bearer.ok) return bearer;
    const r = await mcpListTools(endpoint, bearer.bearer);
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
    const bearer = await resolveBearer(ctx);
    // Chat degrades gracefully when the server (or the OAuth refresh) is
    // down; health is surfaced via testConnection and source status, not by
    // breaking the chat panel.
    if (!bearer.ok) return [];
    const r = await mcpListTools(endpoint, bearer.bearer);
    if (!r.ok) return [];
    return selectChatTools(r.tools, ctx.source.chat_tool_allowlist).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
      execute: async (input: Record<string, unknown>) => {
        // Re-resolved at call time (not reused from the listing above): a
        // long chat session can outlive a short-lived access token, and
        // resolveBearer is a no-op network-wise once the cached token is
        // still valid.
        const freshBearer = await resolveBearer(ctx);
        if (!freshBearer.ok) return `MCP tool error (${freshBearer.kind}): ${freshBearer.reason}`;
        const res = await mcpCallTool(endpoint, freshBearer.bearer, t.name, input);
        return res.ok ? res.content : `MCP tool error (${res.kind}): ${res.reason}`;
      },
    }));
  },
};
