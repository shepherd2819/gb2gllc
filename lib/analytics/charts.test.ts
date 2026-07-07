// lib/analytics/charts.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { linePath, scaleLinear, donutSegments, niceTicks } from "./charts";

test("linePath: empty points → empty string", () => {
  assert.equal(linePath([]), "");
});

test("linePath: M then L commands from pixel points", () => {
  assert.equal(
    linePath([{ x: 0, y: 10 }, { x: 5, y: 20 }, { x: 10, y: 0 }]),
    "M 0 10 L 5 20 L 10 0",
  );
});

test("scaleLinear: maps value into pixel range", () => {
  const s = scaleLinear(100, 200);
  assert.equal(s(50), 100);
  assert.equal(s(0), 0);
  assert.equal(s(100), 200);
});

test("scaleLinear: domainMax 0 collapses to constant 0 (no NaN)", () => {
  const z = scaleLinear(0, 200);
  assert.equal(z(999), 0);
  assert.equal(z(0), 0);
});

test("donutSegments: one wedge per positive item, in order", () => {
  const segs = donutSegments([{ value: 75 }, { value: 25 }], 80, 24);
  assert.equal(segs.length, 2);
});

test("donutSegments: large-arc flag set when a wedge exceeds 180deg", () => {
  const segs = donutSegments([{ value: 75 }, { value: 25 }], 80, 24);
  assert.match(segs[0].d, /A 80 80 0 1 1/); // 75% = 270deg → large-arc 1
  assert.match(segs[1].d, /A 80 80 0 0 1/); // 25% = 90deg  → large-arc 0
});

test("donutSegments: single 100% item renders a full annulus (two subpaths)", () => {
  const segs = donutSegments([{ value: 5 }], 40, 12);
  assert.equal(segs.length, 1);
  assert.match(segs[0].d, /Z M 28 0/); // inner ring radius = 40 - 12 = 28
});

test("donutSegments: zero total → no segments", () => {
  assert.deepEqual(donutSegments([{ value: 0 }], 40, 12), []);
});

test("niceTicks: rounded 1/2/5x10^n ticks from 0 to >= max", () => {
  assert.deepEqual(niceTicks(100, 4), [0, 20, 40, 60, 80, 100]);
});

test("niceTicks: max <= 0 → [0]", () => {
  assert.deepEqual(niceTicks(0, 4), [0]);
});

test("niceTicks: top tick always covers max, first tick is 0", () => {
  const t = niceTicks(950, 5);
  assert.equal(t[0], 0);
  assert.ok(t[t.length - 1] >= 950);
});
