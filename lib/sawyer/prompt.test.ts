import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSawyerSystemPrompt } from "./prompt";

test("system prompt includes identity, rate card, voice rules, and pricing-source rule", () => {
  const p = buildSawyerSystemPrompt({
    kind: "client",
    id: "c1", name: "Jane", company: "BrightLens", email: "j@b.io", status: "active",
    products: ["hollis"], memberCount: 2, hasHollis: true, hollisSummary: 'Hollis live as "Ava".', recentTicketCount: 0,
  });
  assert.match(p, /faith-rooted/i);
  assert.match(p, /Hollis/);
  assert.match(p, /scripture/i);          // voice rule present
  assert.match(p, /BrightLens/);          // live client context injected
  assert.match(p, /rate card/i);          // pricing rule present
  assert.match(p, /needs_confirmation/);  // the finalize pricing-source rule
  assert.match(p, /finalize_proposal/);   // tells model how to finish
});

test("prospect context renders without DB fields", () => {
  const p = buildSawyerSystemPrompt({ kind: "prospect", name: "Acme Corp", company: "Acme", notes: "cold lead" });
  assert.match(p, /Acme Corp/);
  assert.match(p, /prospect/i);
});
