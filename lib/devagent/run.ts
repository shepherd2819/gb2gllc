// lib/devagent/run.ts
import { query as defaultQuery } from "@anthropic-ai/claude-agent-sdk";
import { buildAgents } from "./subagents";
import { buildOrchestratorSystemPrompt } from "./orchestrator";
import { buildPreToolUseHook } from "./guardrails";
import { buildShipServer } from "./ship";
import { newRecord, recordEvent, finalizeRecord, printSummary } from "./record";
import { captureDiff } from "./workspace";
import { DEFAULT_GUARDRAILS } from "./config";
import type {
  DevAgentTask,
  GuardrailsConfig,
  RunResult,
  ShipDecision,
  Workspace,
} from "./types";

export type RunOptions = {
  task: DevAgentTask;
  workspace: Workspace;
  guardrails?: Partial<GuardrailsConfig>;
  /** Testing seam: override the SDK's query function. Real query() is used by default. */
  queryFn?: (input: { prompt: string; options: unknown }) => AsyncIterable<unknown>;
};

type QueryFn = NonNullable<RunOptions["queryFn"]>;

export async function runDevAgent(opts: RunOptions): Promise<RunResult> {
  const queryFn: QueryFn = opts.queryFn ?? (defaultQuery as unknown as QueryFn);
  const guardrails: GuardrailsConfig = {
    ...DEFAULT_GUARDRAILS,
    ...(opts.guardrails ?? {}),
    ...(opts.task.guardrails ?? {}),
  };
  const rec = newRecord(opts.task.description, opts.workspace.branch);

  let shipDecision: ShipDecision | undefined;

  const shipServer = buildShipServer({
    cwd: opts.workspace.cwd,
    branch: opts.workspace.branch,
    guardrails,
    onDecision: (d) => {
      shipDecision = d;
      recordEvent(rec, "ship_decided", d);
    },
  });

  const preToolHook = buildPreToolUseHook(guardrails);

  let totalTokens = 0;
  let totalCost = 0;

  // SDK option object — the shape mirrors the docs at
  // https://code.claude.com/docs/en/agent-sdk/typescript (May 2026).
  const sdkOptions = {
    cwd: opts.workspace.cwd,
    settingSources: ["project"] as Array<"project" | "user" | "local">,
    systemPrompt: buildOrchestratorSystemPrompt(),
    agents: buildAgents(),
    mcpServers: { devagent: shipServer },
    allowedTools: [
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Grep",
      "Glob",
      "Agent",
      "mcp__devagent__ship",
    ],
    hooks: {
      PreToolUse: [{ matcher: "Write|Edit|Bash", hooks: [preToolHook] }],
      PostToolUse: [
        {
          matcher: "*",
          hooks: [
            async (input: unknown) => {
              recordEvent(rec, "tool_post", input);
              return {};
            },
          ],
        },
      ],
      SubagentStop: [
        {
          matcher: "*",
          hooks: [
            async (input: unknown) => {
              recordEvent(rec, "subagent_stop", input);
              return {};
            },
          ],
        },
      ],
    },
    maxTurns: guardrails.budget.maxTurns,
    permissionMode: "acceptEdits" as const,
  };

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
  }, guardrails.budget.maxWallMs);

  try {
    for await (const msg of queryFn({
      prompt: opts.task.description,
      options: sdkOptions,
    })) {
      if (timedOut) break;
      const m = msg as { type: string };
      recordEvent(rec, "message", { type: m.type });
      if (m.type === "result") {
        const r = msg as {
          result?: string;
          total_cost_usd?: number;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        totalCost = r.total_cost_usd ?? 0;
        totalTokens = (r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0);
      }
    }

    const { changes } = await captureDiff(opts.workspace.cwd).catch(() => ({
      changes: [],
    }));

    const result: RunResult = {
      status: timedOut ? "failed" : "completed",
      ship: shipDecision,
      filesChanged: changes,
      tokensUsed: totalTokens,
      costUsd: totalCost,
      error: timedOut ? "wall-clock budget exceeded" : undefined,
    };
    finalizeRecord(rec);
    printSummary(rec, result);
    return result;
  } catch (e) {
    finalizeRecord(rec);
    const result: RunResult = {
      status: "failed",
      filesChanged: [],
      error: (e as Error).message,
    };
    printSummary(rec, result);
    return result;
  } finally {
    clearTimeout(timer);
  }
}
