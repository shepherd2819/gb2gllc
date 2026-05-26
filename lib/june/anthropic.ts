import Anthropic from "@anthropic-ai/sdk";

// June gets her own Anthropic client so her API spend can be tracked and
// rate-limited separately from the main GB2G Claude usage (Maya, intake,
// agents, etc.). Falls back to the shared ANTHROPIC_API_KEY if the dedicated
// June key isn't set yet, so the homepage demo doesn't break mid-deploy.
const apiKey = process.env.JUNE_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;

if (!apiKey && process.env.NODE_ENV !== "test") {
  console.warn("[june] Neither JUNE_ANTHROPIC_API_KEY nor ANTHROPIC_API_KEY is set — June will fail at runtime.");
}

export const juneAnthropic = new Anthropic({ apiKey });
