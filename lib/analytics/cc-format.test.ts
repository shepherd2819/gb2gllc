// lib/analytics/cc-format.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pacePercent, paceBasisLabel, barFraction, splitFormatted } from "./cc-format";
import { fmtCurrency, fmtInt } from "./format";

test("pacePercent: rounds a 0..1 fraction to whole percent", () => {
  assert.equal(pacePercent(0.833), "83%");
  assert.equal(pacePercent(0), "0%");
  assert.equal(pacePercent(1), "100%");
});

test("pacePercent: clamps out-of-range and non-finite to 0..100%", () => {
  assert.equal(pacePercent(1.4), "100%");
  assert.equal(pacePercent(-0.5), "0%");
  assert.equal(pacePercent(NaN), "0%");
});

test("paceBasisLabel: maps each basis to its caption", () => {
  assert.equal(paceBasisLabel("goal"), "of monthly goal");
  assert.equal(paceBasisLabel("yoy"), "vs. same month last year");
  assert.equal(paceBasisLabel("trailing"), "vs. trailing 3-mo avg");
  assert.equal(paceBasisLabel("none"), "no goal set");
});

test("barFraction: value as clamped share of the top value", () => {
  assert.equal(barFraction(50, 100), 0.5);
  assert.equal(barFraction(100, 100), 1);
  assert.equal(barFraction(0, 100), 0);
});

test("barFraction: guards zero/negative/non-finite inputs and over-100%", () => {
  assert.equal(barFraction(10, 0), 0);
  assert.equal(barFraction(10, -5), 0);
  assert.equal(barFraction(NaN, 100), 0);
  assert.equal(barFraction(200, 100), 1);
});

test("splitFormatted: currency splits into $ prefix + toLocaleString core", () => {
  assert.deepEqual(splitFormatted(fmtCurrency, 100054.3), { prefix: "$", core: "100,054" });
});

test("splitFormatted: integer format has no prefix", () => {
  assert.deepEqual(splitFormatted(fmtInt, 286), { prefix: "", core: "286" });
});

test("splitFormatted: core matches the count-up landing value (Math.round + grouping)", () => {
  const { core } = splitFormatted(fmtCurrency, 349.83);
  assert.equal(core, Math.round(349.83).toLocaleString("en-US"));
});
