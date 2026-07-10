// lib/analytics/cc-format.ts
// Pure presentation helpers for the command-center UI (no React, no DOM).
// Tested in cc-format.test.ts. Colors/markup live in the components; this file
// is math + string shaping only.

import type { SnapshotPayload } from "./snapshot";

/** Ring/label percent from a 0..1 fraction; clamps and rounds to a whole %. */
export function pacePercent(fraction: number): string {
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  return `${Math.round(f * 100)}%`;
}

/** Caption describing what the pace-to-goal ring is measured against. */
export function paceBasisLabel(basis: SnapshotPayload["paceToGoal"]["basis"]): string {
  switch (basis) {
    case "goal":
      return "of monthly goal";
    case "yoy":
      return "vs. same month last year";
    case "trailing":
      return "vs. trailing 3-mo avg";
    default:
      return "no goal set";
  }
}

/** Inline-bar width fraction 0..1 for a ranked row: value as share of the top value. */
export function barFraction(value: number, top: number): number {
  if (!(top > 0) || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value / top));
}

/**
 * Split a formatter's output into a leading non-digit prefix (e.g. "$") and the
 * numeric core, so an integer count-up (CounterAnimation writes
 * `Math.round(target).toLocaleString()`) can restore the exact static display
 * without clobbering the currency symbol. Rounds first so the core matches the
 * animation's landing value.
 */
export function splitFormatted(
  format: (n: number) => string,
  value: number,
): { prefix: string; core: string } {
  const full = format(Math.round(value));
  const i = full.search(/[0-9]/);
  if (i < 0) return { prefix: "", core: full };
  return { prefix: full.slice(0, i), core: full.slice(i) };
}
