// lib/analytics/types.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dimensionKey } from "./types";

test("dimensionKey of an empty object is the empty string", () => {
  assert.equal(dimensionKey({}), "");
});

test("dimensionKey sorts keys so serialization is insertion-order independent", () => {
  assert.equal(dimensionKey({ product: "Photos", company: "Acme" }), "company=Acme|product=Photos");
  assert.equal(dimensionKey({ company: "Acme", product: "Photos" }), "company=Acme|product=Photos");
});

test("dimensionKey escapes | in values as %7C", () => {
  assert.equal(dimensionKey({ company: "Smith|Jones Realty" }), "company=Smith%7CJones Realty");
});

test("dimensionKey escapes = in values as %3D", () => {
  assert.equal(dimensionKey({ status: "a=b" }), "status=a%3Db");
});

test("dimensionKey handles a value containing both separators", () => {
  assert.equal(dimensionKey({ note: "x=y|z" }), "note=x%3Dy%7Cz");
});
