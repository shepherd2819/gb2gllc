// lib/analytics/goal.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGoalPatch } from "./goal";

test("validateGoalPatch: accepts a positive number, rounding to cents", () => {
  const v = validateGoalPatch({ revenue: 150000.005 });
  assert.ok(v.ok);
  if (v.ok) assert.equal(v.value.revenue, 150000.01);
});

test("validateGoalPatch: accepts zero", () => {
  const v = validateGoalPatch({ revenue: 0 });
  assert.ok(v.ok);
  if (v.ok) assert.equal(v.value.revenue, 0);
});

test("validateGoalPatch: rejects a negative number", () => {
  assert.equal(validateGoalPatch({ revenue: -1 }).ok, false);
});

test("validateGoalPatch: rejects a non-number revenue", () => {
  assert.equal(validateGoalPatch({ revenue: "100" }).ok, false);
});

test("validateGoalPatch: rejects NaN and Infinity", () => {
  assert.equal(validateGoalPatch({ revenue: NaN }).ok, false);
  assert.equal(validateGoalPatch({ revenue: Infinity }).ok, false);
});

test("validateGoalPatch: rejects a null body or a missing revenue field", () => {
  assert.equal(validateGoalPatch(null).ok, false);
  assert.equal(validateGoalPatch({}).ok, false);
});
