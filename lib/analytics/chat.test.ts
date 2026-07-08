// lib/analytics/chat.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatTools,
  runChatTurn,
  slugifyLabel,
  capToolResult,
  CHAT_MODEL,
  MAX_TOOL_LOOPS,
  DAILY_MESSAGE_CAP,
  type ChatContext,
  type ChatFinalMessage,
  type ChatModelClient,
} from "./chat";
import type { ChatTool, DataSourceRow, ProviderAdapter, SourceCtx, StoredMetric } from "./types";

// ── fixtures ─────────────────────────────────────────────────────

function fakeSource(overrides: Partial<DataSourceRow> = {}): DataSourceRow {
  return {
    id: "src-1",
    client_id: "client-a",
    kind: "mcp",
    provider: "generic_mcp",
    label: "Spiro — Production",
    config: {},
    secret_enc: null,
    chat_tool_allowlist: ["search_orders"],
    status: "active",
    last_sync_at: null,
    last_sync_error: null,
    created_at: "2026-07-07T00:00:00Z",
    updated_at: "2026-07-07T00:00:00Z",
    ...overrides,
  };
}

const ctx: ChatContext = { today: "2026-07-07", kpiSummary: "Revenue this month: $100,054.30", sourceLabels: ["Spiro — Production"] };

type StreamParams = Parameters<ChatModelClient["messages"]["stream"]>[0];

function makeStream(message: ChatFinalMessage) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const block of message.content) {
        if (block.type === "text" && block.text) {
          yield { type: "content_block_delta", delta: { type: "text_delta", text: block.text } };
        }
      }
    },
    finalMessage: async () => message,
  };
}

function makeClient(script: ChatFinalMessage[]) {
  const calls: StreamParams[] = [];
  const client: ChatModelClient = {
    messages: {
      stream(params) {
        calls.push(params);
        return makeStream(script[Math.min(calls.length - 1, script.length - 1)]);
      },
    },
  };
  return { client, calls };
}

const toolUseTurn: ChatFinalMessage = {
  content: [
    {
      type: "tool_use",
      id: "tu_1",
      name: "query_metrics",
      input: { metric: "orders.count", grain: "month", from: "2026-01-01", to: "2026-06-30" },
    },
  ],
  stop_reason: "tool_use",
  usage: { input_tokens: 10, output_tokens: 5 },
};

const endTurn: ChatFinalMessage = {
  content: [{ type: "text", text: "Done." }],
  stop_reason: "end_turn",
  usage: { input_tokens: 3, output_tokens: 2 },
};

// ── constants are the contract ───────────────────────────────────

test("pinned constants match the contract sheet", () => {
  assert.equal(CHAT_MODEL, "claude-sonnet-4-6");
  assert.equal(MAX_TOOL_LOOPS, 8);
  assert.equal(DAILY_MESSAGE_CAP, 200);
});

// ── slug + namespacing ───────────────────────────────────────────

test("slugifyLabel lowercases and collapses non-alphanumerics to single underscores", () => {
  assert.equal(slugifyLabel("Spiro — Production"), "spiro_production");
  assert.equal(slugifyLabel("ACME 2.0!"), "acme_2_0");
});

test("buildChatTools puts query_metrics first and namespaces adapter tools src_<slug>_<tool>", async () => {
  const adapter: ProviderAdapter = {
    provider: "generic_mcp",
    testConnection: async () => ({ ok: true, info: { detail: "ok" } }),
    sync: async () => ({ ok: false, kind: "unsupported", reason: "chat-only" }),
    chatTools: async () => [
      { name: "search_orders", description: "Search orders", input_schema: { type: "object" }, execute: async () => "rows" },
    ],
  };
  const ctxs: SourceCtx[] = [{ source: fakeSource(), secret: null }];
  const tools = await buildChatTools("client-a", ctxs, {
    queryMetrics: async () => [],
    adapterFor: () => adapter,
  });
  assert.equal(tools[0].name, "query_metrics");
  assert.equal(tools[1].name, "src_spiro_production_search_orders");
  assert.equal(await tools[1].execute({}), "rows");
});

// ── clientId is a closure, never model input ─────────────────────

test("query_metrics uses the session clientId; model-supplied client_id in input is ignored", async () => {
  let seenClientId: string | null = null;
  const tools = await buildChatTools("client-a", [], {
    queryMetrics: async (clientId) => {
      seenClientId = clientId;
      return [];
    },
  });
  const out = await tools[0].execute({
    metric: "orders.revenue",
    grain: "month",
    from: "2026-01-01",
    to: "2026-06-30",
    client_id: "client-b",
    clientId: "client-b",
  });
  assert.equal(seenClientId, "client-a");
  assert.equal(out, "[]");
});

// ── result size cap ──────────────────────────────────────────────

test("query_metrics output is capped at 20000 chars with a truncation marker", async () => {
  const bigRows: StoredMetric[] = Array.from({ length: 3000 }, (_, i) => ({
    source_id: "src-1",
    metric: "orders.revenue",
    grain: "month",
    period_start: "2026-01-01",
    period_end: "2026-01-31",
    dimension: { company: `Company number ${i} with a fairly long name` },
    value: i,
  }));
  const tools = await buildChatTools("client-a", [], { queryMetrics: async () => bigRows });
  const out = await tools[0].execute({ metric: "orders.revenue", grain: "month", from: "2026-01-01", to: "2026-12-31" });
  assert.ok(out.length <= 20000, `expected <= 20000, got ${out.length}`);
  assert.match(out, /truncated/);
  assert.equal(capToolResult("short"), "short");
});

// ── loop cap ─────────────────────────────────────────────────────

test("runChatTurn stops after MAX_TOOL_LOOPS iterations and sums token usage", async () => {
  const { client, calls } = makeClient([toolUseTurn]); // always asks for another tool
  const tools: ChatTool[] = [
    { name: "query_metrics", description: "q", input_schema: { type: "object" }, execute: async () => "[]" },
  ];
  const emitted: string[] = [];
  const result = await runChatTurn(
    { clientId: "client-a", conversationId: "conv-1", userText: "hi", history: [], tools },
    (t) => emitted.push(t),
    client,
    ctx,
  );
  assert.equal(calls.length, MAX_TOOL_LOOPS);
  assert.equal(result.toolCalls.length, MAX_TOOL_LOOPS);
  assert.equal(result.model, CHAT_MODEL);
  assert.equal(result.tokensUsed, 15 * MAX_TOOL_LOOPS);
  // Exhausting the loop with no text answer must yield a non-empty fallback,
  // both returned (persisted) and emitted (streamed to the client) — never an empty reply.
  assert.notEqual(result.content.trim(), "");
  assert.match(result.content, /tool-call limit/);
  assert.ok(emitted.join("").includes("tool-call limit"), "fallback should be streamed via emit");
});

// ── tool errors ──────────────────────────────────────────────────

test("a throwing tool records ok:false and sends an is_error tool_result", async () => {
  const { client, calls } = makeClient([toolUseTurn, endTurn]);
  const tools: ChatTool[] = [
    {
      name: "query_metrics",
      description: "q",
      input_schema: { type: "object" },
      execute: async () => {
        throw new Error("boom");
      },
    },
  ];
  let streamed = "";
  const result = await runChatTurn(
    { clientId: "client-a", conversationId: "conv-1", userText: "hi", history: [], tools },
    (t) => {
      streamed += t;
    },
    client,
    ctx,
  );
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].ok, false);
  assert.equal(result.toolCalls[0].name, "query_metrics");

  const second = calls[1];
  const lastMsg = second.messages[second.messages.length - 1];
  const blocks = lastMsg.content as Array<{ type: string; tool_use_id?: string; is_error?: boolean; content?: string }>;
  assert.equal(blocks[0].type, "tool_result");
  assert.equal(blocks[0].tool_use_id, "tu_1");
  assert.equal(blocks[0].is_error, true);
  assert.match(String(blocks[0].content), /boom/);

  assert.equal(result.content, "Done.");
  assert.equal(streamed, "Done.");
});

// ── system prompt: caching + injection posture ───────────────────

test("system blocks carry cache_control on the context block and the required guards", async () => {
  const { client, calls } = makeClient([endTurn]);
  const result = await runChatTurn(
    { clientId: "client-a", conversationId: "conv-1", userText: "hi", history: [{ role: "user", content: "earlier" }], tools: [] },
    () => {},
    client,
    ctx,
  );
  const first = calls[0];
  assert.equal(first.model, CHAT_MODEL);
  const lastBlock = first.system[first.system.length - 1];
  assert.equal(lastBlock.cache_control?.type, "ephemeral");
  const allSystem = first.system.map((b) => b.text).join("\n");
  assert.match(allSystem, /untrusted/i);
  assert.match(allSystem, /read-only/i);
  assert.match(allSystem, /tool results/i);
  assert.match(allSystem, /2026-07-07/);
  // history precedes the new user turn
  assert.equal(first.messages.length, 2);
  assert.equal(first.messages[0].content, "earlier");
  assert.equal(result.content, "Done.");
});
