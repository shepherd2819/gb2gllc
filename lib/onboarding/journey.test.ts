import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStage, nextStage, isAtLeast, computeTtvTarget } from "./journey";

test("deriveStage: nothing done -> invited", () => {
  assert.equal(deriveStage([{ key: "sign_contract", status: "done" }, { key: "book_kickoff", status: "pending" }]), "invited");
});
test("deriveStage: kickoff booked -> kickoff_scheduled", () => {
  assert.equal(deriveStage([{ key: "book_kickoff", status: "done" }]), "kickoff_scheduled");
});
test("deriveStage: paid beats kickoff -> provisioning", () => {
  assert.equal(deriveStage([{ key: "book_kickoff", status: "done" }, { key: "pay_invoice", status: "done" }]), "provisioning");
});
test("deriveStage: first agent live -> adopted", () => {
  assert.equal(deriveStage([{ key: "first_agent_live", status: "done" }]), "adopted");
});

test("nextStage never regresses below current", () => {
  assert.equal(nextStage("activated", "kickoff_scheduled"), "activated");
});
test("nextStage honors a higher explicit event stage", () => {
  assert.equal(nextStage("provisioning", "provisioning", "activated"), "activated");
});
test("nextStage from stalled recovers to the derived stage", () => {
  assert.equal(nextStage("stalled", "provisioning"), "provisioning");
});

test("isAtLeast", () => {
  assert.equal(isAtLeast("activated", "provisioning"), true);
  assert.equal(isAtLeast("invited", "activated"), false);
  assert.equal(isAtLeast("stalled", "invited"), false);
});

test("computeTtvTarget adds days", () => {
  assert.equal(computeTtvTarget("2026-06-01T00:00:00.000Z", 14), "2026-06-15T00:00:00.000Z");
});
