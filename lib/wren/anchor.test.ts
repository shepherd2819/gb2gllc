// lib/wren/anchor.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeRecentLogs } from "./anchor";

test("summarizeRecentLogs returns null for empty input", () => {
  assert.equal(summarizeRecentLogs([]), null);
});

test("summarizeRecentLogs joins up to 3 recent entries with dates", () => {
  const out = summarizeRecentLogs([
    { created_at: "2026-05-27T10:00:00Z", message: "Herald digest sent" },
    { created_at: "2026-05-26T10:00:00Z", message: "Onboarding step 2 done" },
    { created_at: "2026-05-25T10:00:00Z", message: "Account created" },
    { created_at: "2026-05-24T10:00:00Z", message: "Should be dropped" },
  ]);
  assert.ok(out && out.includes("Herald digest sent"));
  assert.ok(out && out.includes("Onboarding step 2 done"));
  assert.ok(out && out.includes("Account created"));
  assert.ok(out && !out.includes("Should be dropped"));
});
