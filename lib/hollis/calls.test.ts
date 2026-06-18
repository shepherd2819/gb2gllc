import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeCaptured, buildDeliveryRecord } from "./calls";

test("mergeCaptured from empty records first tool", () => {
  const c = mergeCaptured(null, "take_message", { name: "Pat", message: "call back" });
  assert.deepEqual(c._tools, ["take_message"]);
  assert.deepEqual(c.take_message, { name: "Pat", message: "call back" });
});

test("mergeCaptured appends a second tool and merges same-tool fields", () => {
  let c = mergeCaptured(null, "book_appointment", { name: "Pat" });
  c = mergeCaptured(c, "book_appointment", { service: "Photo" });
  c = mergeCaptured(c, "transfer_to_human", { reason: "complex" });
  assert.deepEqual(c._tools, ["book_appointment", "transfer_to_human"]);
  assert.deepEqual(c.book_appointment, { name: "Pat", service: "Photo" });
});

test("buildDeliveryRecord splits caller identity from detail fields", () => {
  const captured = mergeCaptured(null, "book_appointment", {
    name: "Jordan", phone: "831", email: "j@kw.com", service: "Photo", property: "12 Oak St",
  });
  const rec = buildDeliveryRecord(captured, "booking_request", "BrightLens", "c1", "+1831");
  assert.ok(rec);
  assert.equal(rec!.kind, "booking_request");
  assert.equal(rec!.caller.name, "Jordan");
  assert.equal(rec!.fields.service, "Photo");
  assert.equal(rec!.fields.property, "12 Oak St");
  assert.equal(rec!.fields.name, undefined); // identity not duplicated into detail
  assert.equal(rec!.callerNumber, "+1831");
});

test("buildDeliveryRecord returns null for non-delivering outcomes", () => {
  const captured = mergeCaptured(null, "transfer_to_human", { reason: "x" });
  assert.equal(buildDeliveryRecord(captured, "transfer", "B", "c1"), null);
  assert.equal(buildDeliveryRecord(captured, "no_action", "B", "c1"), null);
});
