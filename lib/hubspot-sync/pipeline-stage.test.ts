import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveStageId } from "./pipeline-stage";
import type { PipelineStage } from "./pipeline-stage";

const stages: PipelineStage[] = [
  { label: "Open", id: "s-open" },
  { label: "Processed", id: "s-processed" },
  { label: "Shipped", id: "s-shipped" },
  { label: "Delivered", id: "s-delivered" },
  { label: "Cancelled", id: "s-cancelled" },
];

test("resolveStageId maps each known Spiro status to its confirmed stage", () => {
  assert.equal(resolveStageId("pending", stages), "s-open");
  assert.equal(resolveStageId("awaitingConfirmation", stages), "s-open");
  assert.equal(resolveStageId("confirmed", stages), "s-processed");
  assert.equal(resolveStageId("rescheduled", stages), "s-processed");
  assert.equal(resolveStageId("inProgress", stages), "s-processed");
  assert.equal(resolveStageId("appointmentCompleted", stages), "s-shipped");
  assert.equal(resolveStageId("editing", stages), "s-shipped");
  assert.equal(resolveStageId("delivered", stages), "s-delivered");
  assert.equal(resolveStageId("cancelled", stages), "s-cancelled");
});

test("resolveStageId returns null for a status with no mapping", () => {
  assert.equal(resolveStageId("some_unknown_status", stages), null);
});

test("resolveStageId returns null when the mapped label isn't in the live pipeline", () => {
  assert.equal(resolveStageId("delivered", stages.filter((s) => s.label !== "Delivered")), null);
});

test("resolveStageId matches stage labels case-insensitively", () => {
  const lower: PipelineStage[] = [{ label: "open", id: "s-open" }];
  assert.equal(resolveStageId("pending", lower), "s-open");
});
