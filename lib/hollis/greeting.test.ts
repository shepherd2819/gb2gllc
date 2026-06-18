import { test } from "node:test";
import assert from "node:assert/strict";
import { composeGreeting } from "./greeting";

test("includes business name, agent name, and recording notice", () => {
  const g = composeGreeting({ businessName: "BrightLens Media", agentName: "Ava", recordingEnabled: true });
  assert.match(g, /BrightLens Media/);
  assert.match(g, /Ava/);
  assert.match(g, /AI assistant/i);
  assert.match(g, /recorded/i);
});

test("omits recording line when recording disabled", () => {
  const g = composeGreeting({ businessName: "BrightLens Media", agentName: "Ava", recordingEnabled: false });
  assert.doesNotMatch(g, /recorded/i);
  assert.match(g, /AI assistant/i);
});

test("greeting_override is used but disclosure + recording are still enforced", () => {
  const g = composeGreeting({ businessName: "X", agentName: "Ava", recordingEnabled: true, override: "Hey, thanks for calling X!" });
  assert.match(g, /Hey, thanks for calling X!/);
  assert.match(g, /AI assistant/i);
  assert.match(g, /recorded/i);
});

test("override that already discloses is not double-disclosed", () => {
  const g = composeGreeting({ businessName: "X", agentName: "Ava", recordingEnabled: false, override: "Hi, I'm Ava, X's AI assistant!" });
  assert.equal((g.match(/AI assistant/gi) ?? []).length, 1);
});
