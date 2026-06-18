import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeliveryEmail, buildCrmPayload, type DeliveryRecord } from "./delivery";

const rec: DeliveryRecord = {
  kind: "booking_request",
  businessName: "BrightLens Media",
  caller: { name: "Jordan Agent", phone: "831-239-8123", email: "j@kw.com" },
  fields: { service: "Listing photo + video", property: "12 Oak St", preferred_times: "Fri AM" },
  callId: "c1",
  callerNumber: "+18312398123",
};

test("email subject names the kind + business", () => {
  const e = buildDeliveryEmail(rec);
  assert.match(e.subject, /booking/i);
  assert.match(e.subject, /BrightLens Media/);
  assert.match(e.html, /BrightLens Media/);
  assert.match(e.html, /12 Oak St/);
  assert.match(e.text, /Jordan Agent/);
});

test("crm payload is a flat object with kind + caller + fields", () => {
  const p = buildCrmPayload(rec);
  assert.equal(p.kind, "booking_request");
  assert.equal(p.caller_name, "Jordan Agent");
  assert.equal(p.caller_number, "+18312398123");
  assert.equal(p.call_id, "c1");
  assert.equal(p.service, "Listing photo + video");
  assert.equal(p.property, "12 Oak St");
});

test("html escapes angle brackets in fields", () => {
  const e = buildDeliveryEmail({ ...rec, fields: { note: "<script>x</script>" } });
  assert.doesNotMatch(e.html, /<script>/);
});
