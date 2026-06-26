// DB layer for onboarding journeys + milestones. Pure logic lives in
// journey.ts / milestones.ts / templates.ts; this module reads/writes Supabase
// (lazy import per repo convention) and is idempotent where the pipeline retries.

import { templateFor } from "./templates";
import { seedRows } from "./milestones";
import { deriveStage, nextStage, computeTtvTarget } from "./journey";
import { emitEvent } from "./audit";
import type { JourneyRow, MilestoneRow, OnboardingStage, OnboardingTier, MilestoneStatus } from "./types";

export async function getJourney(clientId: string): Promise<JourneyRow | null> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin
    .from("onboarding_journeys")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle<JourneyRow>();
  return data ?? null;
}

export async function getMilestones(journeyId: string): Promise<MilestoneRow[]> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin
    .from("onboarding_milestones")
    .select("*")
    .eq("journey_id", journeyId)
    .order("sort_order", { ascending: true });
  return (data as MilestoneRow[]) ?? [];
}

// Idempotent: returns the existing journey or creates one (+ seeds milestones).
export async function ensureJourney(
  clientId: string,
  opts: { product?: string; tier?: OnboardingTier } = {},
): Promise<JourneyRow | null> {
  const { supabaseAdmin } = await import("@/lib/supabase");

  const existing = await getJourney(clientId);
  if (existing) return existing;

  const tier = opts.tier ?? "self_serve";
  const tmpl = templateFor(opts.product ?? "standard", tier);
  const { data: created } = await supabaseAdmin
    .from("onboarding_journeys")
    .insert({
      client_id: clientId,
      template: tmpl.key,
      tier,
      ttv_target_at: computeTtvTarget(new Date().toISOString()),
    })
    .select("*")
    .maybeSingle<JourneyRow>();

  // Lost a create race (UNIQUE client_id) — re-fetch the winner.
  if (!created) return getJourney(clientId);

  await supabaseAdmin.from("onboarding_milestones").insert(seedRows(created.id, tmpl.milestones));
  await emitEvent({ journeyId: created.id, clientId, kind: "journey_created", payload: { template: tmpl.key, tier } });
  return created;
}

export async function setMilestoneStatus(
  clientId: string,
  key: string,
  status: MilestoneStatus,
  actor = "system",
): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const journey = await getJourney(clientId);
  if (!journey) return;

  await supabaseAdmin
    .from("onboarding_milestones")
    .update({ status, completed_at: status === "done" ? new Date().toISOString() : null })
    .eq("journey_id", journey.id)
    .eq("key", key);

  await emitEvent({ journeyId: journey.id, clientId, kind: `milestone_${status}`, actor, payload: { key } });
  await recomputeStage(clientId);
}

export const completeMilestone = (clientId: string, key: string, actor = "system") =>
  setMilestoneStatus(clientId, key, "done", actor);

// Recompute stage from milestones + an optional explicit event stage (e.g. the
// provision step passing 'activated'). Never regresses; stamps activated/completed.
export async function recomputeStage(clientId: string, eventStage?: OnboardingStage): Promise<OnboardingStage | null> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const journey = await getJourney(clientId);
  if (!journey) return null;

  const milestones = await getMilestones(journey.id);
  const derived = deriveStage(milestones.map((m) => ({ key: m.key, status: m.status })));
  const ns = nextStage(journey.stage, derived, eventStage);
  if (ns === journey.stage) return ns;

  const patch: Record<string, unknown> = { stage: ns, updated_at: new Date().toISOString() };
  if (ns === "activated" && !journey.activated_at) patch.activated_at = new Date().toISOString();
  if (ns === "complete" && !journey.completed_at) patch.completed_at = new Date().toISOString();

  await supabaseAdmin.from("onboarding_journeys").update(patch).eq("id", journey.id);
  await emitEvent({ journeyId: journey.id, clientId, kind: "stage_changed", payload: { from: journey.stage, to: ns } });
  return ns;
}
