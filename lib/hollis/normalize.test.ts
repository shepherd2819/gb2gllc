import { test } from "node:test";
import assert from "node:assert/strict";
import { toSpokenForm } from "./normalize";

test("currency → words", () => {
  assert.equal(toSpokenForm("That's $42.50 total."), "That's forty-two dollars and fifty cents total.");
});

test("whole-dollar currency", () => {
  assert.equal(toSpokenForm("$300 deposit"), "three hundred dollars deposit");
});

test("phone number spoken in groups", () => {
  assert.match(toSpokenForm("Call (831) 239-8123"), /eight three one/);
});

test("time of day", () => {
  assert.equal(toSpokenForm("at 2:30pm"), "at two thirty PM");
});

test("leaves ordinary text untouched", () => {
  assert.equal(toSpokenForm("We shoot listings on Tuesdays."), "We shoot listings on Tuesdays.");
});

test("single dollar is singular", () => {
  assert.equal(toSpokenForm("$1 fee"), "one dollar fee");
});

test("on-the-hour time", () => {
  assert.equal(toSpokenForm("at 9:00am"), "at nine AM");
});
