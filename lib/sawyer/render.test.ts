// lib/sawyer/render.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { orderedSections, renderProposalHtml } from "./render";
import type { Proposal } from "./types";

const proposal: Proposal = {
  id: "p1", client_id: "c1", prospect_name: null,
  title: "Proposal for BrightLens Media", status: "draft",
  sections: [
    { key: "terms", heading: "Terms", body: "Ownership stays with you." },
    { key: "cover", heading: "Cover", body: "Prepared for BrightLens." },
    { key: "scope", heading: "Scope", body: "Hollis receptionist." },
  ],
  pricing: { source: "rate_card", items: [{ label: "Hollis — Growth", amount: 3000, cadence: "monthly" }], summary: "Month-to-month." },
  markdown: null, public_token: "tok", viewed_at: null,
  created_by: "john@gb2gllc.com", created_at: "", updated_at: "",
};

test("orderedSections puts cover first and terms last", () => {
  const ord = orderedSections(proposal.sections);
  assert.equal(ord[0].key, "cover");
  assert.equal(ord[ord.length - 1].key, "terms");
});

test("renderProposalHtml is escaped, branded, includes sections + pricing", () => {
  const html = renderProposalHtml(proposal);
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /Proposal for BrightLens Media/);
  assert.match(html, /Hollis receptionist/);
  assert.match(html, /\$3,000\/mo/);
  assert.match(html, /GB2G/);
});

test("renderProposalHtml escapes HTML in body to prevent injection", () => {
  const evil = { ...proposal, sections: [{ key: "cover", heading: "Cover", body: "<script>alert(1)</script>" }] };
  const html = renderProposalHtml(evil);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("renderProposalHtml escapes single quotes (attribute hardening)", () => {
  const html = renderProposalHtml({ ...proposal, title: "O'Brien & Sons" });
  assert.ok(!html.includes("O'Brien"));
  assert.match(html, /O&#39;Brien/);
});
