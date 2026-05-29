import { test } from "node:test";
import assert from "node:assert/strict";
import { decideTicketStatus } from "./ticket-update";

test("decideTicketStatus: ada_dispatched -> in_progress", () => {
  assert.equal(decideTicketStatus("ada_dispatched", {}), "in_progress");
});

test("decideTicketStatus: ada_completed with merged=true -> resolved", () => {
  assert.equal(decideTicketStatus("ada_completed", { merged: true }), "resolved");
});

test("decideTicketStatus: ada_completed with merged=false -> awaiting_review", () => {
  assert.equal(decideTicketStatus("ada_completed", { merged: false }), "awaiting_review");
});

test("decideTicketStatus: ada_completed with merged absent -> awaiting_review (fail-safe)", () => {
  assert.equal(decideTicketStatus("ada_completed", {}), "awaiting_review");
});

test("decideTicketStatus: ada_failed -> awaiting_review", () => {
  assert.equal(decideTicketStatus("ada_failed", { error: "boom" }), "awaiting_review");
});

import { buildTicketUpdatePayload } from "./ticket-update";

test("buildTicketUpdatePayload: ada_dispatched → in_progress, no resolved_at key", () => {
  const p = buildTicketUpdatePayload("ada_dispatched", "run-1", {});
  assert.equal(p.status, "in_progress");
  assert.equal(p.ada_run_id, "run-1");
  assert.equal("resolved_at" in p, false);
});

test("buildTicketUpdatePayload: ada_completed merged=true → resolved with resolved_at set", () => {
  const p = buildTicketUpdatePayload("ada_completed", "run-1", { merged: true });
  assert.equal(p.status, "resolved");
  assert.equal(p.ada_run_id, "run-1");
  assert.equal(typeof p.resolved_at, "string");
  assert.match(p.resolved_at as string, /^\d{4}-\d{2}-\d{2}T/);
});

test("buildTicketUpdatePayload: ada_completed merged=false → awaiting_review, no resolved_at key", () => {
  const p = buildTicketUpdatePayload("ada_completed", "run-1", { merged: false });
  assert.equal(p.status, "awaiting_review");
  assert.equal("resolved_at" in p, false);
});

test("buildTicketUpdatePayload: ada_failed → awaiting_review, no resolved_at key", () => {
  const p = buildTicketUpdatePayload("ada_failed", "run-1", { error: "boom" });
  assert.equal(p.status, "awaiting_review");
  assert.equal("resolved_at" in p, false);
});
