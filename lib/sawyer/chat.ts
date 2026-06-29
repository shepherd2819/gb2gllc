// lib/sawyer/chat.ts
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/anthropic";
import type { ChatMessage, ProposalPricing, ProposalSection } from "./types";

export const SAWYER_MODEL = "claude-sonnet-4-6";
export const SAWYER_MAX_TOKENS = 2048;

const PRICING_SOURCES = ["rate_card", "custom_override", "needs_confirmation"];
const CADENCES = ["monthly", "one_time", "annual"];

export const FINALIZE_TOOL: Anthropic.Tool = {
  name: "finalize_proposal",
  description:
    "Emit the complete structured proposal so it can be saved and rendered. Call this whenever the proposal is ready or after an accepted revision.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Proposal title, e.g. 'Proposal for BrightLens Media'" },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            heading: { type: "string" },
            body: { type: "string", description: "Markdown body" },
          },
          required: ["key", "heading", "body"],
        },
      },
      pricing: {
        type: "object",
        properties: {
          source: { type: "string", enum: PRICING_SOURCES },
          summary: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                amount: { type: ["number", "null"] },
                cadence: { type: "string", enum: CADENCES },
                note: { type: "string" },
              },
              required: ["label", "cadence"],
            },
          },
        },
        required: ["source", "items"],
      },
    },
    required: ["title", "sections", "pricing"],
  },
};

type ValidateOk = { ok: true; title: string; sections: ProposalSection[]; pricing: ProposalPricing };
type ValidateErr = { ok: false; error: string };

export function validateFinalizePayload(input: unknown): ValidateOk | ValidateErr {
  const v = input as Record<string, unknown>;
  if (!v || typeof v.title !== "string" || v.title.trim().length === 0) {
    return { ok: false, error: "title required" };
  }
  if (!Array.isArray(v.sections) || v.sections.length === 0) {
    return { ok: false, error: "sections required" };
  }
  for (const s of v.sections as unknown[]) {
    const sec = s as Record<string, unknown>;
    if (typeof sec.key !== "string" || typeof sec.heading !== "string" || typeof sec.body !== "string") {
      return { ok: false, error: "each section needs key/heading/body" };
    }
  }
  const pricing = v.pricing as Record<string, unknown> | undefined;
  if (!pricing || !PRICING_SOURCES.includes(pricing.source as string)) {
    return { ok: false, error: "pricing.source must be rate_card | custom_override | needs_confirmation" };
  }
  if (!Array.isArray(pricing.items)) {
    return { ok: false, error: "pricing.items required" };
  }
  for (const it of pricing.items as unknown[]) {
    const item = it as Record<string, unknown>;
    if (typeof item.label !== "string" || !CADENCES.includes(item.cadence as string)) {
      return { ok: false, error: "each pricing item needs label + valid cadence" };
    }
    if (item.amount != null && typeof item.amount !== "number") {
      return { ok: false, error: "pricing amount must be number or null" };
    }
  }
  return {
    ok: true,
    title: (v.title as string).trim(),
    sections: v.sections as ProposalSection[],
    pricing: pricing as unknown as ProposalPricing,
  };
}

export function streamSawyerTurn(args: { system: string; messages: ChatMessage[] }) {
  return anthropic.messages.stream({
    model: SAWYER_MODEL,
    max_tokens: SAWYER_MAX_TOKENS,
    // Cache the (stable) system prompt so multi-turn proposal refinement
    // reuses it instead of re-billing the full company knowledge each turn.
    system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
    tools: [FINALIZE_TOOL],
    messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
  });
}
