// Pure journey state-machine logic. Stage is derived from completed milestones,
// combined with explicit event-driven stages (e.g. provisioning sets 'activated')
// and never regresses. DB read/write lives in store.ts; this stays testable.

import type { OnboardingStage, MilestoneStatus } from "./types";

export const STAGE_ORDER: OnboardingStage[] = [
  "invited",
  "kickoff_scheduled",
  "provisioning",
  "activated",
  "adopted",
  "complete",
];

// A completed milestone implies the journey is at least this stage.
const MILESTONE_MIN_STAGE: Record<string, OnboardingStage> = {
  book_kickoff: "kickoff_scheduled",
  pay_invoice: "provisioning",
  first_agent_live: "adopted",
  go_live: "complete",
};

export function stageIndex(stage: OnboardingStage): number {
  return STAGE_ORDER.indexOf(stage); // 'stalled' -> -1
}

export function isAtLeast(stage: OnboardingStage, target: OnboardingStage): boolean {
  const a = stageIndex(stage);
  const b = stageIndex(target);
  return a >= 0 && b >= 0 && a >= b;
}

export function deriveStage(milestones: { key: string; status: MilestoneStatus }[]): OnboardingStage {
  let best: OnboardingStage = "invited";
  for (const m of milestones) {
    const min = m.status === "done" ? MILESTONE_MIN_STAGE[m.key] : undefined;
    if (min && stageIndex(min) > stageIndex(best)) best = min;
  }
  return best;
}

// The next stage is the furthest-along of: current, milestone-derived, and an
// explicit event stage (e.g. provision sets 'activated'). Never regresses.
export function nextStage(
  current: OnboardingStage,
  derived: OnboardingStage,
  eventStage?: OnboardingStage,
): OnboardingStage {
  const ranked = [current, derived, eventStage]
    .filter((s): s is OnboardingStage => !!s && stageIndex(s) >= 0);
  if (ranked.length === 0) return current;
  return ranked.reduce((a, b) => (stageIndex(b) > stageIndex(a) ? b : a));
}

const DAY_MS = 24 * 60 * 60 * 1000;
export function computeTtvTarget(startIso: string, days = 14): string {
  return new Date(new Date(startIso).getTime() + days * DAY_MS).toISOString();
}
