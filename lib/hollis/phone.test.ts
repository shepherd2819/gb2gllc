// lib/hollis/phone.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCallerNumber } from "./phone";

test("normalizes US numbers to E.164", () => {
  assert.equal(normalizeCallerNumber("+18435551234"), "+18435551234");
  assert.equal(normalizeCallerNumber("8435551234"), "+18435551234");
  assert.equal(normalizeCallerNumber("18435551234"), "+18435551234");
  assert.equal(normalizeCallerNumber("(843) 555-1234"), "+18435551234");
});

test("returns null for unusable input", () => {
  assert.equal(normalizeCallerNumber(""), null);
  assert.equal(normalizeCallerNumber(null), null);
  assert.equal(normalizeCallerNumber("12345"), null);
});
