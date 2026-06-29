// Tier-driven teammate seat caps (replaces the hardcoded MAX_TEAMMATES=1).
// Tier comes from the client's onboarding journey. These numbers are a starting
// point — align with the real pricing tiers when they're finalized.

import type { OnboardingTier } from "./types";

const SEAT_CAPS: Record<OnboardingTier, number> = {
  self_serve: 1,
  assisted: 5,
  white_glove: 25,
};

export function seatCapForTier(tier: OnboardingTier | null | undefined): number {
  return tier && tier in SEAT_CAPS ? SEAT_CAPS[tier] : SEAT_CAPS.self_serve;
}

export async function getSeatCap(clientId: string): Promise<number> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin
    .from("onboarding_journeys")
    .select("tier")
    .eq("client_id", clientId)
    .maybeSingle<{ tier: OnboardingTier }>();
  return seatCapForTier(data?.tier);
}
