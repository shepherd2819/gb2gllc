// lib/analytics/charts.ts
// Pure SVG geometry for the analytics chart kit. No React, no DOM — unit-tested
// in charts.test.ts and consumed by components/charts/*.

const TAU = Math.PI * 2;

/** Trim to 2dp and drop trailing zeros so path strings stay compact. */
function f(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Number(n.toFixed(2)));
}

/** Categorical accent cycle — semantic tokens only, never hex. */
export const CHART_COLORS = [
  "var(--color-gold)",
  "var(--color-sage)",
  "var(--color-blue)",
  "var(--color-red)",
];

/** "M x0 y0 L x1 y1 …" from already-scaled pixel points. "" when empty. */
export function linePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${f(p.x)} ${f(p.y)}`).join(" ");
}

/** Linear scale value→pixels. domainMax<=0 collapses to constant 0 (no NaN). */
export function scaleLinear(domainMax: number, rangePx: number): (v: number) => number {
  if (!(domainMax > 0)) return () => 0;
  return (v: number) => (v / domainMax) * rangePx;
}

function pointOnCircle(angle: number, r: number): { x: number; y: number } {
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
}

/**
 * Donut ring wedges centered on (0,0), one per positive-value item in order.
 * Angles sweep clockwise from 12 o'clock; a wedge wider than 180° sets the SVG
 * large-arc flag. A single 100% item renders as a full annulus (evenodd fill).
 */
export function donutSegments(
  items: Array<{ value: number }>,
  radius: number,
  thickness: number,
): Array<{ d: string }> {
  const R = radius;
  const r = Math.max(0, radius - thickness);
  const total = items.reduce((s, it) => s + Math.max(0, it.value), 0);
  if (total <= 0) return [];
  const out: Array<{ d: string }> = [];
  let a = -Math.PI / 2; // start at top
  for (const it of items) {
    const v = Math.max(0, it.value);
    if (v <= 0) continue;
    const sweep = (v / total) * TAU;
    if (sweep >= TAU - 1e-9) {
      out.push({
        d:
          `M ${f(R)} 0 A ${f(R)} ${f(R)} 0 1 1 ${f(-R)} 0 A ${f(R)} ${f(R)} 0 1 1 ${f(R)} 0 Z ` +
          `M ${f(r)} 0 A ${f(r)} ${f(r)} 0 1 0 ${f(-r)} 0 A ${f(r)} ${f(r)} 0 1 0 ${f(r)} 0 Z`,
      });
      a += sweep;
      continue;
    }
    const a1 = a + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const o0 = pointOnCircle(a, R);
    const o1 = pointOnCircle(a1, R);
    const i1 = pointOnCircle(a1, r);
    const i0 = pointOnCircle(a, r);
    out.push({
      d:
        `M ${f(o0.x)} ${f(o0.y)} ` +
        `A ${f(R)} ${f(R)} 0 ${large} 1 ${f(o1.x)} ${f(o1.y)} ` +
        `L ${f(i1.x)} ${f(i1.y)} ` +
        `A ${f(r)} ${f(r)} 0 ${large} 0 ${f(i0.x)} ${f(i0.y)} Z`,
    });
    a = a1;
  }
  return out;
}

function niceNum(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nice: number;
  if (round) {
    if (frac < 1.5) nice = 1;
    else if (frac < 3) nice = 2;
    else if (frac < 7) nice = 5;
    else nice = 10;
  } else {
    if (frac <= 1) nice = 1;
    else if (frac <= 2) nice = 2;
    else if (frac <= 5) nice = 5;
    else nice = 10;
  }
  return nice * Math.pow(10, exp);
}

/** Axis ticks 0…≥max on 1/2/5×10ⁿ steps, ~count intervals. [0] when max<=0. */
export function niceTicks(max: number, count: number): number[] {
  if (!(max > 0) || count < 1) return [0];
  const range = niceNum(max, false);
  const step = niceNum(range / count, true);
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= niceMax + step * 0.5; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}
