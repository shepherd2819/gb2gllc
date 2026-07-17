// lib/palette-search.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPaletteEntries, rankPalette } from "./palette-search";

const CLIENTS = [
  { id: "c1", name: "Jane", company: "Acme Roofing", email: "jane@acme.com" },
  { id: "c2", name: null, company: null, email: "solo@nowhere.com" },
];
const AGENTS = [
  { slug: "iris", name: "Iris", tagline: "Inbox triage", glyph: "✉" },
  { slug: "hollis", name: "Hollis", tagline: "AI phone receptionist", glyph: "☎" },
];

test("buildPaletteEntries: client title falls back company → name → email; invoice action targets billing", () => {
  const entries = buildPaletteEntries(CLIENTS, AGENTS);
  const acme = entries.find((e) => e.kind === "client" && e.href === "/clients/c1")!;
  assert.equal(acme.title, "Acme Roofing");
  const solo = entries.find((e) => e.kind === "client" && e.href === "/clients/c2")!;
  assert.equal(solo.title, "solo@nowhere.com");
  const invoice = entries.find((e) => e.kind === "action" && e.href === "/billing?client=c1")!;
  assert.equal(invoice.title, "Invoice Acme Roofing");
});

test("buildPaletteEntries includes the static pages and the agents", () => {
  const entries = buildPaletteEntries([], AGENTS);
  const hrefs = entries.map((e) => e.href);
  for (const h of ["/admin", "/clients", "/submissions", "/support", "/billing", "/journeys", "/agents"]) {
    assert.ok(hrefs.includes(h), `missing page ${h}`);
  }
  assert.ok(entries.some((e) => e.kind === "agent" && e.href === "/agents/iris"));
});

test("rankPalette: empty query returns only pages + agents, capped at limit", () => {
  const entries = buildPaletteEntries(CLIENTS, AGENTS);
  const out = rankPalette("", entries, 8);
  assert.ok(out.length <= 8);
  assert.ok(out.every((e) => e.kind === "page" || e.kind === "agent"));
});

test("rankPalette: title prefix beats substring; unmatched tokens exclude an entry", () => {
  const entries = buildPaletteEntries(CLIENTS, AGENTS);
  const acmeFirst = rankPalette("acme", entries, 8);
  assert.equal(acmeFirst[0].title, "Acme Roofing"); // direct nav ranks above the invoice action
  assert.deepEqual(rankPalette("zzz-no-match", entries, 8), []);
});

test("rankPalette: multi-token 'invoice acme' surfaces the invoice action first", () => {
  const entries = buildPaletteEntries(CLIENTS, AGENTS);
  const out = rankPalette("invoice acme", entries, 8);
  assert.equal(out[0].href, "/billing?client=c1");
});

test("rankPalette: agent lookup by name", () => {
  const entries = buildPaletteEntries(CLIENTS, AGENTS);
  assert.equal(rankPalette("iris", entries, 8)[0].href, "/agents/iris");
});
