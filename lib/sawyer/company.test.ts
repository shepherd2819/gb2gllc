import { test } from "node:test";
import assert from "node:assert/strict";
import { RATE_CARD, getRateCardItem, rateCardForPrompt, GB2G_IDENTITY, GB2G_VOICE_RULES } from "./company";

test("rate card includes the four products by key", () => {
  const keys = RATE_CARD.map((r) => r.key).sort();
  assert.deepEqual(keys, ["atrium", "herald", "hollis", "steward"]);
});

test("every rate card item has a display price and a valid status", () => {
  for (const item of RATE_CARD) {
    assert.ok(item.display.length > 0, `${item.key} missing display`);
    assert.ok(["available", "launching", "custom"].includes(item.status), `${item.key} bad status`);
  }
});

test("Hollis is the voice-AI managed tier", () => {
  const h = getRateCardItem("hollis");
  assert.ok(h);
  assert.match(h!.display, /1,500/);
  assert.match(h!.display, /5,000/);
});

test("getRateCardItem returns undefined for unknown key", () => {
  assert.equal(getRateCardItem("nope"), undefined);
});

test("rateCardForPrompt lists every product with its price", () => {
  const s = rateCardForPrompt();
  assert.match(s, /Hollis/);
  assert.match(s, /Atrium/);
  assert.match(s, /18,000/);
});

test("identity is faith-rooted but business-first; voice forbids scripture in product context", () => {
  assert.match(GB2G_IDENTITY, /faith-rooted/i);
  assert.match(GB2G_VOICE_RULES, /scripture/i);
});
