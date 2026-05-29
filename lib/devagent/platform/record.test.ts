// lib/devagent/platform/record.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { statusFromResult } from "./record";
import type { RunResult } from "@/lib/devagent/types";

test("statusFromResult: failed → failed", () => {
  const r: RunResult = { status: "failed", filesChanged: [] };
  assert.equal(statusFromResult(r), "failed");
});

test("statusFromResult: completed + ship.merged=true → completed_merged", () => {
  const r: RunResult = {
    status: "completed",
    filesChanged: [],
    ship: { prUrl: "https://x/pr/1", merged: true, evaluation: { eligible: true, reasons: ["ok"], message: "ok" }, verify: { ok: true, steps: [] } },
  };
  assert.equal(statusFromResult(r), "completed_merged");
});

test("statusFromResult: completed + ship.merged=false → completed_needs_review", () => {
  const r: RunResult = {
    status: "completed",
    filesChanged: [],
    ship: { prUrl: "https://x/pr/1", merged: false, evaluation: { eligible: false, reasons: ["too_many_files"], message: "too big" }, verify: { ok: true, steps: [] } },
  };
  assert.equal(statusFromResult(r), "completed_needs_review");
});

test("statusFromResult: completed + no ship → completed_needs_review (defensive)", () => {
  const r: RunResult = { status: "completed", filesChanged: [] };
  assert.equal(statusFromResult(r), "completed_needs_review");
});
