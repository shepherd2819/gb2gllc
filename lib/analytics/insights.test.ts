// lib/analytics/insights.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { findCandidates, parseInsights, INSIGHTS_MODEL } from "./insights";
import type { SnapshotPayload } from "./snapshot";

function makePayload(overrides: Partial<SnapshotPayload> = {}): SnapshotPayload {
  const months = [
    "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
  ];
  return {
    generatedAt: "2026-07-15T12:00:00.000Z",
    kpis: {
      revenueThisMonth: 100000,
      ordersThisMonth: 250,
      avgOrderValue: 400,
      activeCustomers: 40,
      revenueMoM: null,
      ordersMoM: null,
    },
    trend: months.map((month) => ({ month, revenue: 0, orders: 0 })),
    productMix: [],
    statusMix: [],
    topCompanies: [],
    topAgents: [],
    sources: [],
    ...overrides,
  };
}

// ── findCandidates ─────────────────────────────────────────────────────────

test("MoM movers beyond ±10% become facts with real numbers", () => {
  const base = makePayload();
  const p = makePayload({ kpis: { ...base.kpis, revenueMoM: 0.25, ordersMoM: -0.15 } });
  const facts = findCandidates(p);
  const revenueFact = facts.find((f) => f.startsWith("Revenue"));
  const ordersFact = facts.find((f) => f.startsWith("Orders"));
  assert.ok(revenueFact?.includes("+25.0%"));
  assert.ok(revenueFact?.includes("$100,000"));
  assert.ok(ordersFact?.includes("-15.0%"));
  assert.ok(ordersFact?.includes("250"));
});

test("MoM within ±10% or null produces no mover facts", () => {
  const base = makePayload();
  const small = makePayload({ kpis: { ...base.kpis, revenueMoM: 0.05, ordersMoM: -0.1 } });
  assert.equal(findCandidates(small).length, 0);
  assert.equal(findCandidates(makePayload()).length, 0);
});

test("best and worst trend months become facts when they differ", () => {
  const p = makePayload();
  p.trend[2] = { month: "2025-09", revenue: 152925, orders: 507 };
  p.trend[11] = { month: "2026-06", revenue: 42000, orders: 120 };
  const facts = findCandidates(p);
  assert.ok(facts.some((f) => f.includes("Best month") && f.includes("2025-09") && f.includes("$152,925")));
  assert.ok(facts.some((f) => f.includes("Worst month") && f.includes("2026-06") && f.includes("$42,000")));
});

test("a single non-zero trend month yields no best/worst facts", () => {
  const p = makePayload();
  p.trend[2] = { month: "2025-09", revenue: 152925, orders: 507 };
  assert.equal(findCandidates(p).length, 0);
});

test("a product above 30% of mix becomes a fact; the Other bucket never does", () => {
  const p = makePayload({
    productMix: [
      { name: "Photos", revenue: 90000 },
      { name: "Video", revenue: 30000 },
      { name: "Other", revenue: 15000 },
    ],
  });
  const facts = findCandidates(p);
  const fact = facts.find((f) => f.startsWith("Photos"));
  assert.ok(fact);
  assert.ok(fact.includes("66.7%"));
  assert.equal(facts.some((f) => f.startsWith("Other")), false);
});

test("a top company above 25% of trailing-3-month revenue becomes a fact", () => {
  const p = makePayload({
    topCompanies: [{ name: "Acme Realty", revenue: 90000, orders: 200 }],
  });
  p.trend[10] = { month: "2026-05", revenue: 100000, orders: 240 };
  p.trend[11] = { month: "2026-06", revenue: 100000, orders: 260 };
  p.trend[12] = { month: "2026-07", revenue: 100000, orders: 250 };
  const facts = findCandidates(p);
  const fact = facts.find((f) => f.includes("Acme Realty"));
  assert.ok(fact);
  assert.ok(fact.includes("30.0%"));
});

// ── parseInsights ──────────────────────────────────────────────────────────

test("parseInsights accepts a valid JSON array", () => {
  const cards = parseInsights('[{"title":"Revenue up","body":"Revenue rose 25% to $100,000.","tone":"up"}]');
  assert.deepEqual(cards, [{ title: "Revenue up", body: "Revenue rose 25% to $100,000.", tone: "up" }]);
});

test("parseInsights strips markdown fences", () => {
  const raw = '```json\n[{"title":"T","body":"B","tone":"down"}]\n```';
  assert.deepEqual(parseInsights(raw), [{ title: "T", body: "B", tone: "down" }]);
});

test("parseInsights returns [] on malformed JSON and non-arrays", () => {
  assert.deepEqual(parseInsights("not json at all"), []);
  assert.deepEqual(parseInsights('{"title":"T","body":"B"}'), []);
  assert.deepEqual(parseInsights(""), []);
});

test("parseInsights falls back to neutral for unknown tones and drops incomplete cards", () => {
  const raw = JSON.stringify([
    { title: "T", body: "B", tone: "sideways" },
    { title: "", body: "B", tone: "up" },
    { body: "no title", tone: "up" },
  ]);
  assert.deepEqual(parseInsights(raw), [{ title: "T", body: "B", tone: "neutral" }]);
});

test("parseInsights truncates title to 60 and body to 240, caps at 5 cards", () => {
  const long = { title: "x".repeat(100), body: "y".repeat(300), tone: "up" };
  const raw = JSON.stringify([long, long, long, long, long, long, long]);
  const cards = parseInsights(raw);
  assert.equal(cards.length, 5);
  assert.equal(cards[0].title.length, 60);
  assert.equal(cards[0].body.length, 240);
});

test("model const is pinned", () => {
  assert.equal(INSIGHTS_MODEL, "claude-sonnet-4-6");
});
