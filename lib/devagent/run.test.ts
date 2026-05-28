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
