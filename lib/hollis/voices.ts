import type { VoiceProfile } from "./types";

// Two curated, deeply-tuned voices. We perfect two rather than offer many
// mediocre ones. Exact Cartesia voice ids are confirmed by auditioning at
// play.cartesia.ai/voices and can be overridden via env without a code change.
// Recommended pairing: Katie (female), Jameson (male).
export const VOICE_PROFILES: Record<VoiceProfile, { voiceId: string; defaultName: string }> = {
  female: {
    voiceId: process.env.HOLLIS_VOICE_FEMALE_ID ?? "cartesia:katie",
    defaultName: "Ava",
  },
  male: {
    voiceId: process.env.HOLLIS_VOICE_MALE_ID ?? "cartesia:jameson",
    defaultName: "Marcus",
  },
};

export function resolveVoice(profile: VoiceProfile): { voiceId: string; defaultName: string } {
  return VOICE_PROFILES[profile];
}
