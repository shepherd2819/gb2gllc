// lib/analytics/format.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtCurrency, fmtCompactCurrency, fmtInt, fmtDelta, fmtMonthLabel } from "./format";

test("fmtCurrency: rounds to whole dollars with grouping and $", () => {
  assert.equal(fmtCurrency(100054.3), "$100,054");
  assert.equal(fmtCurrency(0), "$0");
});

test("fmtCompactCurrency: k / M suffixes for axis labels", () => {
  assert.equal(fmtCompactCurrency(100054), "$100k");
  assert.equal(fmtCompactCurrency(1470000), "$1.5M");
  assert.equal(fmtCompactCurrency(500), "$500");
});

test("fmtInt: grouped integer", () => {
  assert.equal(fmtInt(286), "286");
  assert.equal(fmtInt(4579), "4,579");
});

test("fmtDelta: positive ratio → up tone, up arrow, signed percent", () => {
  const d = fmtDelta(0.123);
  assert.equal(d.tone, "up");
  assert.equal(d.arrow, "▲");
  assert.equal(d.text, "+12%");
});

test("fmtDelta: negative ratio → down tone, down arrow", () => {
  const d = fmtDelta(-0.08);
  assert.equal(d.tone, "down");
  assert.equal(d.arrow, "▼");
  assert.equal(d.text, "-8%");
});

test("fmtDelta: null → neutral em-dash", () => {
  assert.deepEqual(fmtDelta(null), { text: "—", arrow: "—", tone: "neutral" });
});

test("fmtDelta: exactly zero → neutral 0%", () => {
  const d = fmtDelta(0);
  assert.equal(d.tone, "neutral");
  assert.equal(d.text, "0%");
});

test("fmtMonthLabel: YYYY-MM → short month", () => {
  assert.equal(fmtMonthLabel("2026-06"), "Jun");
  assert.equal(fmtMonthLabel("2026-01"), "Jan");
});

test("fmtMonthLabel: full ISO date also works", () => {
  assert.equal(fmtMonthLabel("2026-06-15"), "Jun");
});

test("fmtMonthLabel: unparseable input passes through unchanged", () => {
  assert.equal(fmtMonthLabel("bogus"), "bogus");
});
