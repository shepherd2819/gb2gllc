import { test } from "node:test";
import assert from "node:assert/strict";
import { generateToken, flattenToMarkdown } from "./store";

test("generateToken is url-safe and >= 24 chars and unique", () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 24);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("flattenToMarkdown renders headings, bodies, and a pricing block", () => {
  const md = flattenToMarkdown(
    "Proposal for BrightLens",
    [
      { key: "about", heading: "About GB2G", body: "We build practical AI." },
      { key: "scope", heading: "Scope", body: "Hollis receptionist." },
    ],
    {
      source: "rate_card",
      items: [{ label: "Hollis — Growth", amount: 3000, cadence: "monthly" }],
      summary: "Month-to-month.",
    }
  );
  assert.match(md, /# Proposal for BrightLens/);
  assert.match(md, /## About GB2G/);
  assert.match(md, /We build practical AI\./);
  assert.match(md, /## Pricing/);
  assert.match(md, /Hollis — Growth/);
  assert.match(md, /\$3,000\/mo/);
});

test("flattenToMarkdown tolerates null pricing", () => {
  const md = flattenToMarkdown("X", [{ key: "a", heading: "A", body: "b" }], null);
  assert.match(md, /## A/);
  assert.ok(!md.includes("## Pricing"));
});
