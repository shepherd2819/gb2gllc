// lib/hubspot-sync/window.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOrderSyncFloor } from "./window";

test("recently-configured cutoff: floor is cutoff_date itself (never backfill before it)", () => {
  // now - 30 days = 2026-06-16T09:30:00.000Z, which is BEFORE the cutoff
  // (2026-07-10) — the trailing window hasn't caught up to the cutoff yet,
  // so the floor must stay at the cutoff, never earlier.
  const now = new Date("2026-07-16T09:30:00.000Z");
  assert.equal(computeOrderSyncFloor(now, "2026-07-10"), "2026-07-10T00:00:00.000Z");
});

test("long-running feature: floor is the trailing 30-day boundary, not cutoff_date", () => {
  // now - 30 days = 2026-06-16T09:30:00.000Z, which is AFTER the old cutoff
  // (2025-01-01) — the checkpoint has long since passed the cutoff, so the
  // floor is bounded to the trailing 30-day window instead of growing
  // unboundedly back toward the cutoff.
  const now = new Date("2026-07-16T09:30:00.000Z");
  assert.equal(computeOrderSyncFloor(now, "2025-01-01"), "2026-06-16T09:30:00.000Z");
});

test("boundary: trailing floor exactly equal to cutoff resolves to cutoff", () => {
  const now = new Date("2026-07-31T00:00:00.000Z");
  // now - 30 days lands exactly on the cutoff instant.
  assert.equal(computeOrderSyncFloor(now, "2026-07-01"), "2026-07-01T00:00:00.000Z");
});

test("returned value is always a valid ISO string", () => {
  const now = new Date("2026-07-16T09:30:00.000Z");
  for (const cutoff of ["2026-07-10", "2025-01-01", "2026-01-01"]) {
    const floor = computeOrderSyncFloor(now, cutoff);
    assert.equal(new Date(floor).toISOString(), floor);
  }
});
