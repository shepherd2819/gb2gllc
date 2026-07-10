// lib/analytics/present.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPresentSlides } from "./present";
import type { SnapshotPayload } from "./snapshot";

function payloadOf(over: Partial<SnapshotPayload> = {}): SnapshotPayload {
  return {
    generatedAt: "2026-07-08T00:00:00.000Z",
    kpis: {
      revenueThisMonth: 100000,
      ordersThisMonth: 286,
      avgOrderValue: 349.65,
      activeCustomers: 42,
      revenueMoM: 0.12,
      ordersMoM: -0.03,
    },
    trend: [],
    productMix: [],
    statusMix: [],
    topCompanies: [{ name: "Acme", revenue: 50000, orders: 120 }],
    topAgents: [],
    sources: [],
    yoy: { revenueYoY: 0.25, ordersYoY: null },
    paceToGoal: { target: 150000, mtd: 100000, projected: 145000, fraction: 0.66, basis: "goal" },
    tileSparks: { revenue: [1, 2, 3], orders: [1, 2, 3], avgOrderValue: [1, 2, 3], activeCustomers: [1, 2, 3] },
    ...over,
  };
}

test("buildPresentSlides: full payload + briefing → northstar, movers, briefing, companies in order", () => {
  const slides = buildPresentSlides(payloadOf(), "Revenue is up.");
  assert.deepEqual(slides.map((s) => s.kind), ["northstar", "movers", "briefing", "companies"]);
});

test("buildPresentSlides: northstar is always first and carries the month revenue", () => {
  const slides = buildPresentSlides(payloadOf(), "");
  assert.equal(slides[0].kind, "northstar");
  if (slides[0].kind === "northstar") assert.equal(slides[0].value, 100000);
});

test("buildPresentSlides: empty briefing omits the briefing slide", () => {
  const slides = buildPresentSlides(payloadOf(), "");
  assert.equal(slides.some((s) => s.kind === "briefing"), false);
  assert.deepEqual(slides.map((s) => s.kind), ["northstar", "movers", "companies"]);
});

test("buildPresentSlides: whitespace-only briefing is treated as empty", () => {
  const slides = buildPresentSlides(payloadOf(), "   \n  ");
  assert.equal(slides.some((s) => s.kind === "briefing"), false);
});

test("buildPresentSlides: no top companies omits the companies slide", () => {
  const slides = buildPresentSlides(payloadOf({ topCompanies: [] }), "hi");
  assert.deepEqual(slides.map((s) => s.kind), ["northstar", "movers", "briefing"]);
});

test("buildPresentSlides: movers include revenue MoM, orders MoM, and revenue YoY", () => {
  const slides = buildPresentSlides(payloadOf(), "");
  const movers = slides.find((s) => s.kind === "movers");
  assert.ok(movers && movers.kind === "movers");
  if (movers.kind === "movers") {
    assert.deepEqual(movers.items.map((i) => i.label), ["Revenue MoM", "Orders MoM", "Revenue YoY"]);
    assert.deepEqual(movers.items.map((i) => i.delta), [0.12, -0.03, 0.25]);
  }
});
