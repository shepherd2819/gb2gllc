import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyRetellSignature, parseLifecycle } from "./webhook";

const SECRET = "whsec_test";
const body = JSON.stringify({ event: "call_analyzed", call: { call_id: "c1", to_number: "+18315551234" } });
const goodSig = createHmac("sha256", SECRET).update(body).digest("hex");

test("accepts a valid signature", () => {
  assert.equal(verifyRetellSignature(body, goodSig, SECRET), true);
});
test("rejects a tampered body", () => {
  assert.equal(verifyRetellSignature(body + "x", goodSig, SECRET), false);
});
test("rejects a bad signature", () => {
  assert.equal(verifyRetellSignature(body, "deadbeef", SECRET), false);
});
test("rejects a missing signature", () => {
  assert.equal(verifyRetellSignature(body, null, SECRET), false);
});
test("parseLifecycle extracts event + call id + to_number", () => {
  const p = parseLifecycle(JSON.parse(body));
  assert.equal(p.event, "call_analyzed");
  assert.equal(p.retellCallId, "c1");
  assert.equal(p.toNumber, "+18315551234");
});
