// lib/analytics/goal.ts
// Pure validation for the admin monthly-goal PATCH
// (app/api/admin/clients/[id]/analytics/goal). No DB — unit-tested.

export type GoalPatch =
  | { ok: true; value: { revenue: number } }
  | { ok: false; reason: string };

/**
 * Accepts { revenue: number } where revenue is finite and >= 0, rounded to
 * cents. Rejects missing/non-object bodies, non-number/NaN/Infinity/negative
 * revenue.
 */
export function validateGoalPatch(body: unknown): GoalPatch {
  if (typeof body !== "object" || body === null) {
    return { ok: false, reason: "body must be an object" };
  }
  const revenue = (body as { revenue?: unknown }).revenue;
  if (typeof revenue !== "number" || !Number.isFinite(revenue)) {
    return { ok: false, reason: "revenue must be a finite number" };
  }
  if (revenue < 0) {
    return { ok: false, reason: "revenue must be >= 0" };
  }
  return { ok: true, value: { revenue: Math.round(revenue * 100) / 100 } };
}
