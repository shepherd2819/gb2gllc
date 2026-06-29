import { test } from "node:test";
import assert from "node:assert/strict";
import { seatCapForTier } from "./seats";

test("seat caps per tier", () => {
  assert.equal(seatCapForTier("self_serve"), 1);
  assert.equal(seatCapForTier("assisted"), 5);
  assert.equal(seatCapForTier("white_glove"), 25);
});

test("unknown/missing tier falls back to self_serve cap", () => {
  assert.equal(seatCapForTier(null), 1);
  assert.equal(seatCapForTier(undefined), 1);
});
