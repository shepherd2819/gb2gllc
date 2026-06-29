import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeClientContext, buildProspectContext } from "./context";

const base = {
  client: { id: "c1", name: "Jane Doe", company: "BrightLens Media", email: "jane@bright.io", status: "active" },
  products: [
    { product: "hollis", active: true },
    { product: "herald", active: false },
  ],
  memberCount: 3,
  hollisLine: { agent_name: "Ava", voice_profile: "female" },
  recentTicketCount: 2,
};

test("shapeClientContext keeps only active products and never leaks raw rows", () => {
  const ctx = shapeClientContext(base);
  assert.equal(ctx.kind, "client");
  assert.deepEqual(ctx.products, ["hollis"]);
  assert.equal(ctx.company, "BrightLens Media");
  assert.equal(ctx.hasHollis, true);
  assert.match(ctx.hollisSummary ?? "", /Ava/);
  // shape is flat primitives only — no nested row objects
  assert.equal(typeof ctx.memberCount, "number");
  assert.ok(!("client" in (ctx as object)));
});

test("shapeClientContext without Hollis sets hasHollis false and no summary", () => {
  const ctx = shapeClientContext({ ...base, products: [], hollisLine: null });
  assert.equal(ctx.hasHollis, false);
  assert.equal(ctx.hollisSummary, undefined);
  assert.deepEqual(ctx.products, []);
});

test("buildProspectContext trims and carries notes", () => {
  const p = buildProspectContext({ name: "  Acme Corp ", company: "Acme", notes: "referred by X" });
  assert.equal(p.kind, "prospect");
  assert.equal(p.name, "Acme Corp");
  assert.equal(p.notes, "referred by X");
});
