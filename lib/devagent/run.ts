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

  // CRITICAL: deep-merge the budget sub-object so a partial budget override
  // (e.g. {maxTurns: 100}) does not wipe out maxWallMs/maxTokens.
  const guardrails: GuardrailsConfig = {
    ...DEFAULT_GUARDRAILS,
    ...(opts.guardrails ?? {}),
    ...(opts.task.guardrails ?? {}),
    budget: {
      ...DEFAULT_GUARDRAILS.budget,
      ...(opts.guardrails?.budget ?? {}),
      ...(opts.task.guardrails?.budget ?? {}),
    },
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
            // MINOR: truncate the recorded payload to keep rec.events bounded.
            async (input: unknown) => {
              const i = input as { tool_name?: string; tool_input?: unknown };
              const inputStr =
                typeof i.tool_input === "string"
                  ? i.tool_input
                  : JSON.stringify(i.tool_input ?? {});
              const summary = {
                tool_name: i.tool_name,
                tool_input_preview: inputStr.slice(0, 500),
                tool_input_length: inputStr.length,
              };
              recordEvent(rec, "tool_post", summary);
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
  // IMPORTANT: separate flag to distinguish "timer fired during stream" from
  // "loop actually aborted mid-stream because of the timeout".
  let loopAborted = false;
  let resultSubtype: string | undefined;

  const timer = setTimeout(() => {
    timedOut = true;
  }, guardrails.budget.maxWallMs);

  try {
    for await (const msg of queryFn({
      prompt: opts.task.description,
      options: sdkOptions,
    })) {
      if (timedOut) {
        loopAborted = true;
        break;
      }
      const m = msg as { type: string };
      recordEvent(rec, "message", { type: m.type });
      if (m.type === "result") {
        // IMPORTANT: capture subtype to detect SDK-level failures.
        const r = msg as {
          subtype?: string;
          result?: string;
          total_cost_usd?: number;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        resultSubtype = r.subtype;
        totalCost = r.total_cost_usd ?? 0;
        totalTokens = (r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0);
      }
    }

    // IMPORTANT: determine failure reasons.
    const sdkFailed = resultSubtype != null && resultSubtype !== "success";
    // MINOR: token budget enforcement (detection-after-the-fact for Phase 1).
    const tokenOverrun = totalTokens > guardrails.budget.maxTokens;

    const status: RunResult["status"] =
      loopAborted || sdkFailed || tokenOverrun ? "failed" : "completed";

    const errorReason = loopAborted
      ? "wall-clock budget exceeded"
      : sdkFailed
      ? `SDK result subtype: ${resultSubtype}`
      : tokenOverrun
      ? `token budget exceeded (${totalTokens} > ${guardrails.budget.maxTokens})`
      : undefined;

    // MINOR: surface captureDiff errors instead of silently swallowing them.
    let captureDiffError: string | undefined;
    const { changes } = await captureDiff(opts.workspace.cwd).catch((e: unknown) => {
      captureDiffError = e instanceof Error ? e.message : String(e);
      return { changes: [] };
    });

    const combinedError =
      errorReason ?? (captureDiffError ? `captureDiff failed: ${captureDiffError}` : undefined);

    const result: RunResult = {
      status,
      ship: shipDecision,
      filesChanged: changes,
      verify: shipDecision?.verify,
      tokensUsed: totalTokens,
      costUsd: totalCost,
      error: combinedError,
    };
    finalizeRecord(rec);
    printSummary(rec, result);
    return result;
  } catch (e) {
    // IMPORTANT: preserve accumulated cost/token data; use safe error coercion.
    finalizeRecord(rec);
    const result: RunResult = {
      status: "failed",
      ship: shipDecision,
      filesChanged: [],
      verify: shipDecision?.verify,
      tokensUsed: totalTokens,
      costUsd: totalCost,
      error: e instanceof Error ? e.message : String(e),
    };
    printSummary(rec, result);
    return result;
  } finally {
    clearTimeout(timer);
  }
}
