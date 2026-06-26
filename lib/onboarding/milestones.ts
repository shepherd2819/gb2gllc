// Pure milestone helpers (seeding + derived views). DB writes live in store.ts.

import type { MilestoneSeed, MilestoneStatus, MilestoneOwner } from "./types";

export type MilestoneView = {
  key: string;
  title: string;
  owner: MilestoneOwner;
  status: MilestoneStatus;
  sort_order: number;
};

// Rows ready to insert for a new journey (ids/timestamps filled by the DB).
export function seedRows(journeyId: string, seeds: MilestoneSeed[]) {
  return seeds.map((s) => ({
    journey_id: journeyId,
    key: s.key,
    title: s.title,
    owner: s.owner,
    status: "pending" as MilestoneStatus,
    sort_order: s.sort_order,
  }));
}

// The next thing the CLIENT should do — drives the portal CTA + concierge nudge.
export function nextActionable(milestones: MilestoneView[]): MilestoneView | null {
  const candidates = milestones
    .filter((m) => m.owner === "client" && (m.status === "pending" || m.status === "in_progress"))
    .sort((a, b) => a.sort_order - b.sort_order);
  return candidates[0] ?? null;
}

export function progressSummary(milestones: MilestoneView[]): { total: number; done: number; blocked: number; pct: number } {
  const counted = milestones.filter((m) => m.status !== "skipped");
  const total = counted.length;
  const done = counted.filter((m) => m.status === "done").length;
  const blocked = counted.filter((m) => m.status === "blocked").length;
  return { total, done, blocked, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}
