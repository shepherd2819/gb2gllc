import { test } from "node:test";
import assert from "node:assert/strict";
import { templateFor, TEMPLATES } from "./templates";

test("herald template includes the snippet milestone", () => {
  const t = templateFor("herald", "self_serve");
  assert.equal(t.key, "herald");
  assert.ok(t.milestones.some((m) => m.key === "install_snippet"));
});

test("unknown product falls back to standard", () => {
  const t = templateFor("nonsense", "self_serve");
  assert.equal(t.key, "standard");
  assert.deepEqual(t.milestones.map((m) => m.key), TEMPLATES.standard.map((m) => m.key));
});

test("white_glove adds a security/SSO milestone", () => {
  const t = templateFor("standard", "white_glove");
  assert.ok(t.milestones.some((m) => m.key === "security_review"));
});

test("self_serve does not add the security milestone", () => {
  const t = templateFor("standard", "self_serve");
  assert.ok(!t.milestones.some((m) => m.key === "security_review"));
});

test("sort_order is contiguous from zero", () => {
  const t = templateFor("steward", "white_glove");
  t.milestones.forEach((m, i) => assert.equal(m.sort_order, i));
});
