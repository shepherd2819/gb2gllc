// lib/analytics/charts.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { linePath, scaleLinear, donutSegments, niceTicks, ringArc, areaPath, brushWindow } from "./charts";

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

test("ringArc: partial arc below 50% sets large-arc flag 0, starts at 12 o'clock", () => {
  assert.equal(ringArc(0.25, 50, 10), "M 0 -50 A 50 50 0 0 1 50 0 L 40 0 A 40 40 0 0 0 0 -40 Z");
});

test("ringArc: arc crossing 50% sets large-arc flag 1", () => {
  assert.equal(ringArc(0.75, 50, 10), "M 0 -50 A 50 50 0 1 1 -50 0 L -40 0 A 40 40 0 1 0 0 -40 Z");
});

test("ringArc: fraction >= 1 renders a full annulus (two subpaths, inner radius = R - thickness)", () => {
  const full = ringArc(1, 50, 10);
  assert.match(full, /Z M 40 0/);
  assert.equal(ringArc(1.5, 50, 10), full); // clamped to 1
});

test("ringArc: fraction <= 0 is empty", () => {
  assert.equal(ringArc(0, 50, 10), "");
  assert.equal(ringArc(-0.3, 50, 10), "");
});

test("areaPath: empty points → empty string", () => {
  assert.equal(areaPath([], 100), "");
});

test("areaPath: closes down to the baseline and back to the first x", () => {
  assert.equal(
    areaPath([{ x: 0, y: 10 }, { x: 5, y: 20 }, { x: 10, y: 0 }], 100),
    "M 0 10 L 5 20 L 10 0 L 10 100 L 0 100 Z",
  );
});

test("brushWindow: full 0..1 selection spans every index", () => {
  assert.deepEqual(brushWindow(13, 0, 1), { startIndex: 0, endIndex: 12 });
});

test("brushWindow: fractional selection rounds to inclusive indices", () => {
  assert.deepEqual(brushWindow(13, 0, 0.5), { startIndex: 0, endIndex: 6 });
});

test("brushWindow: reversed inputs are normalized so start <= end", () => {
  assert.deepEqual(brushWindow(13, 0.8, 0.2), { startIndex: 2, endIndex: 10 });
});

test("brushWindow: out-of-range fractions clamp to [0,1]", () => {
  assert.deepEqual(brushWindow(13, -0.5, 2), { startIndex: 0, endIndex: 12 });
});

test("brushWindow: empty or single-item series never produce a bad range", () => {
  assert.deepEqual(brushWindow(0, 0, 1), { startIndex: 0, endIndex: 0 });
  assert.deepEqual(brushWindow(1, 0.3, 0.9), { startIndex: 0, endIndex: 0 });
});
