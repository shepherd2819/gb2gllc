// lib/devagent/run.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Workspace } from "./types";
import { runDevAgent } from "./run";

// Fake query: returns an async iterable matching the SDK's shape, with one
// `result` message containing cost + token usage. Injected via the runDevAgent
// `queryFn` testing seam, so we don't depend on Node's experimental mock.module().
function fakeQuery(_input: { prompt: string; options: unknown }): AsyncIterable<unknown> {
  return (async function* () {
    yield { type: "system" };
    yield {
      type: "result",
      subtype: "success",
      result: "done",
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50 },
    };
  })();
}

const fakeWorkspace: Workspace = {
  cwd: "/tmp/devagent-test-nonexistent",
  branch: "devagent/x",
  slug: "x",
  cleanup: async () => {},
};

test("runDevAgent: consumes the stream and surfaces result + cost", async () => {
  const result = await runDevAgent({
    task: { description: "stub task" },
    workspace: fakeWorkspace,
    queryFn: fakeQuery,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.costUsd, 0.01);
  assert.equal(result.tokensUsed, 150);
});

test("runDevAgent: opts.mission flows into orchestrator system prompt", async () => {
  let capturedOptions: unknown = null;
  const captureQuery = (input: { prompt: string; options: unknown }): AsyncIterable<unknown> => {
    capturedOptions = input.options;
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        result: "done",
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    })();
  };

  await runDevAgent({
    task: { description: "stub" },
    workspace: fakeWorkspace,
    queryFn: captureQuery,
    mission: "Mind the migrations.",
  });

  const sysPrompt = (capturedOptions as { systemPrompt?: { append?: string } })?.systemPrompt;
  assert.ok(sysPrompt?.append, "captureQuery never received systemPrompt.append");
  assert.ok(
    sysPrompt!.append!.startsWith("## Your mission\n\nMind the migrations."),
    `expected mission prefix, got: ${sysPrompt!.append!.slice(0, 80)}`
  );
});

test("runDevAgent: opts.guardrails.budget partial override is deep-merged with defaults", async () => {
  let capturedOptions: unknown = null;
  const captureQuery = (input: { prompt: string; options: unknown }): AsyncIterable<unknown> => {
    capturedOptions = input.options;
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        result: "done",
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    })();
  };

  await runDevAgent({
    task: { description: "stub" },
    workspace: fakeWorkspace,
    queryFn: captureQuery,
    guardrails: { budget: { maxTurns: 7 } },
  });

  const maxTurns = (capturedOptions as { maxTurns?: number }).maxTurns;
  assert.equal(maxTurns, 7, "maxTurns override should reach sdkOptions");
});
