import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSignBody } from "./sign-validation";

test("sign body validation: missing name fails", () => {
  const r = validateSignBody({ signer_representing: "x", agree: true });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 400);
    assert.equal(r.error, "Name and 'representing' are required");
  }
});

test("sign body validation: missing representing fails", () => {
  const r = validateSignBody({ signer_name: "a", agree: true });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 400);
    assert.equal(r.error, "Name and 'representing' are required");
  }
});

test("sign body validation: missing agree fails", () => {
  const r = validateSignBody({ signer_name: "a", signer_representing: "b" });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 400);
    assert.equal(r.error, "You must confirm authority to sign");
  }
});

test("sign body validation: agree=false fails", () => {
  const r = validateSignBody({ signer_name: "a", signer_representing: "b", agree: false });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "You must confirm authority to sign");
});

test("sign body validation: whitespace name fails", () => {
  const r = validateSignBody({ signer_name: "   ", signer_representing: "b", agree: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 400);
});

test("sign body validation: whitespace representing fails", () => {
  const r = validateSignBody({ signer_name: "Alice", signer_representing: "  ", agree: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 400);
});

test("sign body validation: valid passes and trims fields", () => {
  const r = validateSignBody({ signer_name: "  Alice  ", signer_representing: "Acme Inc", agree: true });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.body.signer_name, "Alice");
    assert.equal(r.body.signer_representing, "Acme Inc");
  }
});

test("sign body validation: non-object input fails", () => {
  const r = validateSignBody(null);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 400);
});

test("sign body validation: string input fails", () => {
  const r = validateSignBody("not an object");
  assert.equal(r.ok, false);
});
