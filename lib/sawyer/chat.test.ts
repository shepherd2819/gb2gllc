// lib/sawyer/chat.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFinalizePayload, FINALIZE_TOOL } from "./chat";

const good = {
  title: "Proposal for BrightLens Media",
  sections: [
    { key: "about", heading: "About GB2G", body: "We build practical AI." },
    { key: "scope", heading: "Scope", body: "Hollis receptionist." },
  ],
  pricing: {
    source: "rate_card",
    items: [{ label: "Hollis — Growth", amount: 3000, cadence: "monthly" }],
    summary: "Month-to-month.",
  },
};

test("FINALIZE_TOOL is named finalize_proposal", () => {
  assert.equal(FINALIZE_TOOL.name, "finalize_proposal");
});

test("valid payload passes and returns typed parts", () => {
  const r = validateFinalizePayload(good);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.title, "Proposal for BrightLens Media");
    assert.equal(r.sections.length, 2);
    assert.equal(r.pricing.source, "rate_card");
  }
});

test("rejects pricing without a valid source", () => {
  const r = validateFinalizePayload({ ...good, pricing: { items: [], source: "guess" } });
  assert.equal(r.ok, false);
});

test("rejects missing sections", () => {
  const r = validateFinalizePayload({ title: "x", pricing: good.pricing });
  assert.equal(r.ok, false);
});

test("rejects empty title", () => {
  const r = validateFinalizePayload({ ...good, title: "" });
  assert.equal(r.ok, false);
});

test("rejects pricing item with string amount", () => {
  const bad = { ...good, pricing: { ...good.pricing, items: [{ label: "X", amount: "3000", cadence: "monthly" }] } };
  const r = validateFinalizePayload(bad);
  assert.equal(r.ok, false);
});

test("rejects whitespace-only title", () => {
  const r = validateFinalizePayload({ ...good, title: "   " });
  assert.equal(r.ok, false);
});
