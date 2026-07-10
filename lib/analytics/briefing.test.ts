import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBriefingInput, parseBriefing } from "./briefing";
import { computeSnapshot } from "./snapshot";
import type { StoredMetric } from "./types";

const NOW = new Date("2026-07-15T12:00:00.000Z");

function row(
  metric: string,
  periodStart: string,
  value: number,
  dimension: Record<string, string> = {},
): StoredMetric {
  return {
    source_id: "s",
    metric,
    grain: "month",
    period_start: periodStart,
    period_end: periodStart,
    dimension,
    value,
  };
}

const PAYLOAD_ROWS: StoredMetric[] = [
  row("orders.revenue", "2026-07-01", 100000),
  row("orders.count", "2026-07-01", 250),
  row("orders.revenue", "2025-07-01", 80000),
  row("orders.count", "2025-07-01", 200),
  row("orders.revenue", "2026-06-01", 90000, { product: "Photos" }),
  row("orders.revenue", "2026-07-01", 40000, { company: "Acme Realty" }),
  row("orders.count", "2026-07-01", 60, { company: "Acme Realty" }),
];

test("buildBriefingInput is a pure fact sheet citing the real numbers", () => {
  const payload = computeSnapshot(PAYLOAD_ROWS, [], NOW, { goal: { revenue: 150000 } });
  const input = buildBriefingInput(payload);
  assert.match(input, /Revenue this month: \$100,000/);
  assert.match(input, /YoY \+25\.0%/);
  assert.match(input, /Pace to goal \(goal\)/);
  assert.match(input, /Largest customer .*Acme Realty/);
});

test("parseBriefing returns clean single-line prose unchanged", () => {
  assert.equal(
    parseBriefing("Revenue grew this month by ten percent."),
    "Revenue grew this month by ten percent.",
  );
});

test("parseBriefing strips code fences (with or without a language tag)", () => {
  assert.equal(parseBriefing("```\nRevenue grew.\n```"), "Revenue grew.");
  assert.equal(parseBriefing("```text\nRevenue grew.\n```"), "Revenue grew.");
});

test("parseBriefing strips a single wrapping pair of quotes", () => {
  assert.equal(parseBriefing('"Revenue grew this month."'), "Revenue grew this month.");
});

test("parseBriefing rejects JSON/array/markup garbage as empty string", () => {
  assert.equal(parseBriefing('{"title":"x"}'), "");
  assert.equal(parseBriefing("[1, 2, 3]"), "");
  assert.equal(parseBriefing("<p>hi</p>"), "");
});

test("parseBriefing treats empty/whitespace input as empty string", () => {
  assert.equal(parseBriefing(""), "");
  assert.equal(parseBriefing("   \n  "), "");
});

test("parseBriefing clamps to at most 6 sentences", () => {
  assert.equal(parseBriefing("A. B. C. D. E. F. G. H."), "A. B. C. D. E. F.");
});

test("parseBriefing clamps to at most 600 characters", () => {
  assert.equal(parseBriefing("x".repeat(700)).length, 600);
});
