import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyRetellSignature, parseLifecycle } from "./webhook";

const KEY = "key_test";
const TS = 1780000000000; // fixed ms, passed as nowMs so the replay check is deterministic
const body = JSON.stringify({ event: "call_analyzed", call: { call_id: "c1", to_number: "+18315551234" } });
const digest = createHmac("sha256", KEY).update(body + String(TS)).digest("hex");
const sig = `v=${TS},d=${digest}`;

test("accepts a valid signature", () => {
  assert.equal(verifyRetellSignature(body, sig, KEY, TS), true);
});
test("rejects a tampered body", () => {
  assert.equal(verifyRetellSignature(body + "x", sig, KEY, TS), false);
});
test("rejects a bad digest", () => {
  assert.equal(verifyRetellSignature(body, `v=${TS},d=deadbeef`, KEY, TS), false);
});
test("rejects a stale timestamp (replay)", () => {
  assert.equal(verifyRetellSignature(body, sig, KEY, TS + 6 * 60 * 1000), false);
});
test("rejects a malformed header", () => {
  assert.equal(verifyRetellSignature(body, "garbage", KEY, TS), false);
});
test("rejects a missing signature", () => {
  assert.equal(verifyRetellSignature(body, null, KEY, TS), false);
});
test("parseLifecycle extracts event + call id + to_number", () => {
  const p = parseLifecycle(JSON.parse(body));
  assert.equal(p.event, "call_analyzed");
  assert.equal(p.retellCallId, "c1");
  assert.equal(p.toNumber, "+18315551234");
});
