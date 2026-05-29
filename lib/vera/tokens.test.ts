import { test } from "node:test";
import assert from "node:assert/strict";
import { mintToken, isTokenSignable } from "./tokens";

test("mintToken returns URL-safe string of expected length", () => {
  const t = mintToken();
  assert.match(t, /^[A-Za-z0-9_-]+$/);
  assert.equal(t.length, 43); // base64url of 32 bytes = 43 chars
});

test("mintToken returns unique values", () => {
  const a = mintToken();
  const b = mintToken();
  assert.notEqual(a, b);
});

test("isTokenSignable: sent + future expiry is signable", () => {
  const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
  assert.equal(isTokenSignable({ status: "sent", expires_at: future }), true);
});

test("isTokenSignable: expired is not signable", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  assert.equal(isTokenSignable({ status: "sent", expires_at: past }), false);
});

test("isTokenSignable: voided is not signable", () => {
  const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
  assert.equal(isTokenSignable({ status: "voided", expires_at: future }), false);
});

test("isTokenSignable: already signed is not signable", () => {
  const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
  assert.equal(isTokenSignable({ status: "signed", expires_at: future }), false);
});
