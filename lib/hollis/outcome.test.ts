import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveOutcome } from "./outcome";

test("transfer wins over everything", () => {
  assert.equal(deriveOutcome({ toolsUsed: ["take_message", "transfer_to_human"] }), "transfer");
});
test("booking request", () => {
  assert.equal(deriveOutcome({ toolsUsed: ["book_appointment"] }), "booking_request");
});
test("qualified lead", () => {
  assert.equal(deriveOutcome({ toolsUsed: ["qualify_lead"] }), "qualified_lead");
});
test("message only", () => {
  assert.equal(deriveOutcome({ toolsUsed: ["take_message"] }), "message");
});
test("faq-only call → no_action", () => {
  assert.equal(deriveOutcome({ toolsUsed: ["lookup_faq"] }), "no_action");
});
test("nothing → no_action", () => {
  assert.equal(deriveOutcome({ toolsUsed: [] }), "no_action");
});
test("booking beats lead+message when no transfer", () => {
  assert.equal(deriveOutcome({ toolsUsed: ["qualify_lead", "take_message", "book_appointment"] }), "booking_request");
});
