// lib/devagent/orchestrator.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrchestratorSystemPrompt } from "./orchestrator";

test("buildOrchestratorSystemPrompt: no opts → append starts with PROJECT_RULES marker", () => {
  const out = buildOrchestratorSystemPrompt();
  assert.equal(out.type, "preset");
  assert.equal(out.preset, "claude_code");
  // PROJECT_RULES begins with this header in Phase 1's spec
  assert.ok(out.append.startsWith("## GB2G Project Rules"));
  assert.equal(out.append.includes("## Your mission"), false);
});

test("buildOrchestratorSystemPrompt: explicit undefined mission → identical to no opts", () => {
  const a = buildOrchestratorSystemPrompt();
  const b = buildOrchestratorSystemPrompt({ mission: undefined });
  assert.equal(a.append, b.append);
});

test("buildOrchestratorSystemPrompt: mission provided → appended BEFORE PROJECT_RULES", () => {
  const out = buildOrchestratorSystemPrompt({ mission: "Be cautious about migrations." });
  assert.ok(out.append.startsWith("## Your mission\n\nBe cautious about migrations.\n\n"));
  const missionIdx = out.append.indexOf("## Your mission");
  const rulesIdx = out.append.indexOf("## GB2G Project Rules");
  assert.ok(missionIdx >= 0 && rulesIdx > missionIdx, "mission appears before rules");
});

test("buildOrchestratorSystemPrompt: empty-string mission → treated as no mission", () => {
  const out = buildOrchestratorSystemPrompt({ mission: "" });
  assert.equal(out.append.includes("## Your mission"), false);
});
