// lib/devagent/platform/trigger.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldTrigger } from "./trigger";

const baseAssignment = {
  client_id: "c1",
  trigger_categories: ["Code Fix", "Feature Request"],
  active: true,
};
const baseTicket = { client_id: "c1", category: "Code Fix" };

test("shouldTrigger: active assignment + matching category + matching client", () => {
  assert.equal(shouldTrigger({ assignment: baseAssignment, ticket: baseTicket }), true);
});

test("shouldTrigger: active assignment but ticket category not in allowlist", () => {
  const ticket = { ...baseTicket, category: "Question" };
  assert.equal(shouldTrigger({ assignment: baseAssignment, ticket }), false);
});

test("shouldTrigger: ticket category null", () => {
  const ticket = { ...baseTicket, category: null };
  assert.equal(shouldTrigger({ assignment: baseAssignment, ticket }), false);
});

test("shouldTrigger: inactive assignment", () => {
  const assignment = { ...baseAssignment, active: false };
  assert.equal(shouldTrigger({ assignment, ticket: baseTicket }), false);
});

test("shouldTrigger: no assignment row for client", () => {
  assert.equal(shouldTrigger({ assignment: null, ticket: baseTicket }), false);
});

test("shouldTrigger: empty trigger_categories", () => {
  const assignment = { ...baseAssignment, trigger_categories: [] };
  assert.equal(shouldTrigger({ assignment, ticket: baseTicket }), false);
});

test("shouldTrigger: client_id mismatch (defensive)", () => {
  const ticket = { client_id: "c2", category: "Code Fix" };
  assert.equal(shouldTrigger({ assignment: baseAssignment, ticket }), false);
});
