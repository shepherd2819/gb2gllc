// lib/analytics/crypto.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret, secretLast4 } from "./crypto";

let _originalKey: string | undefined;
before(() => {
  _originalKey = process.env.ANALYTICS_SECRET_KEY;
  process.env.ANALYTICS_SECRET_KEY = randomBytes(32).toString("base64");
});
after(() => {
  if (_originalKey === undefined) delete process.env.ANALYTICS_SECRET_KEY;
  else process.env.ANALYTICS_SECRET_KEY = _originalKey;
});

test("encrypt then decrypt roundtrips arbitrary plaintext", () => {
  const secret = "spk_live_S3cr3t~!@#|=:with unicode 🔑";
  assert.equal(decryptSecret(encryptSecret(secret)), secret);
});

test("blob format is v1:<iv>:<tag>:<ct> with a fresh random IV per call", () => {
  const a = encryptSecret("same-plaintext");
  const b = encryptSecret("same-plaintext");
  const parts = a.split(":");
  assert.equal(parts.length, 4);
  assert.equal(parts[0], "v1");
  assert.equal(Buffer.from(parts[1], "base64").length, 12, "IV must be 12 bytes");
  assert.equal(Buffer.from(parts[2], "base64").length, 16, "GCM auth tag must be 16 bytes");
  assert.notEqual(a, b, "random IV must make repeated encryptions differ");
});

test("tampering with the ciphertext makes decryptSecret throw (GCM auth tag)", () => {
  const parts = encryptSecret("spk_live_abcd1234").split(":");
  const ct = Buffer.from(parts[3], "base64");
  ct[0] = ct[0] ^ 0xff; // flip one ciphertext byte
  parts[3] = ct.toString("base64");
  assert.throws(() => decryptSecret(parts.join(":")));
});

test("a malformed blob throws a clear format error", () => {
  assert.throws(() => decryptSecret("not-an-encrypted-blob"), /v1:<iv>:<tag>:<ct>/);
});

test("missing ANALYTICS_SECRET_KEY throws a clear config error", () => {
  const saved = process.env.ANALYTICS_SECRET_KEY;
  delete process.env.ANALYTICS_SECRET_KEY;
  try {
    assert.throws(() => encryptSecret("x"), /ANALYTICS_SECRET_KEY/);
  } finally {
    process.env.ANALYTICS_SECRET_KEY = saved;
  }
});

test("a key that does not decode to 32 bytes throws a clear config error", () => {
  const saved = process.env.ANALYTICS_SECRET_KEY;
  process.env.ANALYTICS_SECRET_KEY = randomBytes(16).toString("base64");
  try {
    assert.throws(() => encryptSecret("x"), /32 bytes/);
  } finally {
    process.env.ANALYTICS_SECRET_KEY = saved;
  }
});

test("secretLast4 returns the trailing four characters", () => {
  assert.equal(secretLast4("spk_live_abcd1234"), "1234");
  assert.equal(secretLast4("ab"), "ab");
});
