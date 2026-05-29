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
