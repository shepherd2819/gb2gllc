import { test } from "node:test";
import assert from "node:assert/strict";
import { scalarsOnly } from "./workos";

test("scalarsOnly keeps scalars, drops objects/arrays/null", () => {
  const out = scalarsOnly({ a: "x", b: 3, c: true, d: { nested: 1 }, e: [1, 2], f: null });
  assert.deepEqual(out, { a: "x", b: 3, c: true });
});

test("scalarsOnly handles empty/undefined", () => {
  assert.deepEqual(scalarsOnly(undefined), {});
  assert.deepEqual(scalarsOnly(null), {});
  assert.deepEqual(scalarsOnly({}), {});
});

test("scalarsOnly caps at 50 keys", () => {
  const big: Record<string, number> = {};
  for (let i = 0; i < 80; i++) big[`k${i}`] = i;
  assert.equal(Object.keys(scalarsOnly(big)).length, 50);
});
