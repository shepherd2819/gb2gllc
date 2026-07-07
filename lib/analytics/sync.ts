// lib/analytics/sync.ts
//
// Pure, unit-tested helpers for the analytics sync pipeline. The window is a
// single [from, to] range: the trailing 13 calendar months on a normal run
// (which always contains the 60-day span adapters use for day/week-grain
// metrics), or 24 calendar months on a first sync (backfill). Adapters read
// window.backfill and the range; the day/week 60-day sub-window is adapter
// policy, applied inside [from, to].

import type { DataSourceRow, SyncWindow } from "./types";

const NORMAL_MONTHS_BACK = 12; // current month + 12 back = 13 months
const BACKFILL_MONTHS_BACK = 23; // current month + 23 back = 24 months

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function computeSyncWindow(now: Date, isFirstSync: boolean): SyncWindow {
  const monthsBack = isFirstSync ? BACKFILL_MONTHS_BACK : NORMAL_MONTHS_BACK;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  return { from: isoDate(from), to: isoDate(now), backfill: isFirstSync };
}

export function groupSourcesByClient(sources: DataSourceRow[]): Record<string, DataSourceRow[]> {
  const grouped: Record<string, DataSourceRow[]> = {};
  for (const s of sources) {
    (grouped[s.client_id] ??= []).push(s);
  }
  return grouped;
}
