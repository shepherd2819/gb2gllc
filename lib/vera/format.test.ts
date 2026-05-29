import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAmount, cadenceLabel } from "./format";

test("formatAmount: whole dollars", () => {
  assert.equal(formatAmount(240000), "$2,400.00");
});

test("formatAmount: with cents", () => {
  assert.equal(formatAmount(1800050), "$18,000.50");
});

test("formatAmount: zero", () => {
  assert.equal(formatAmount(0), "$0.00");
});

test("formatAmount: small", () => {
  assert.equal(formatAmount(99), "$0.99");
});

test("cadenceLabel maps monthly", () => {
  assert.equal(cadenceLabel("monthly"), "per month");
});

test("cadenceLabel maps one_time", () => {
  assert.equal(cadenceLabel("one_time"), "as a one-time fee");
});

test("cadenceLabel maps hourly", () => {
  assert.equal(cadenceLabel("hourly"), "per hour");
});
