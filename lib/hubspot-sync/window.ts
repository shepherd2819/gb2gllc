// lib/hubspot-sync/window.ts
// Pure, testable computation of the order-sync fetch floor. Never before
// cutoff_date (no backfill, ever) — but bounded to a trailing window so
// in-progress orders (submitted, then confirmed/rescheduled/delivered over
// following days) keep having their status re-checked even long after an
// ever-advancing checkpoint would otherwise have passed their dateSubmitted.
// See docs/superpowers/specs/2026-07-15-elevated-hubspot-order-sync-design.md §8.
const TRAILING_WINDOW_DAYS = 30;

export function computeOrderSyncFloor(now: Date, cutoffDate: string): string {
  const trailingFloor = new Date(now.getTime() - TRAILING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const cutoff = new Date(`${cutoffDate}T00:00:00.000Z`);
  return (trailingFloor.getTime() > cutoff.getTime() ? trailingFloor : cutoff).toISOString();
}
