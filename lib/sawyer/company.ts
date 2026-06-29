// Canonical GB2G knowledge — the "knows us" layer for Sawyer.
// Consolidates facts otherwise scattered across public/about.html and
// lib/anthropic.ts prompt copy. Single source of truth for proposals.
import type { RateCardItem } from "./types";

export const RATE_CARD: RateCardItem[] = [
  {
    key: "hollis",
    product: "Hollis — AI phone receptionist",
    summary:
      "Answers the business phone in a chosen human voice; books appointments, qualifies leads, answers FAQs, takes messages, warm-transfers. Inbound, AI-disclosed, recorded.",
    display: "$1,500–$5,000/mo (managed tiers)",
    amount: null, // tiered — Sawyer selects within the range per scope
    cadence: "monthly",
    status: "available",
  },
  {
    key: "herald",
    product: "Herald — website AI agent",
    summary: "Conversational website agent that greets, qualifies, books, and hands off.",
    display: "$2,400/mo",
    amount: 2400,
    cadence: "monthly",
    status: "available",
  },
  {
    key: "atrium",
    product: "Atrium — AI-assisted website build",
    summary: "AI-assisted website design and build.",
    display: "$18,000/site",
    amount: 18000,
    cadence: "one_time",
    status: "available",
  },
  {
    key: "steward",
    product: "Steward — internal AI employees",
    summary: "Internal AI employees for ops, research, finance, and support.",
    display: "Custom (launching Q2 2026)",
    amount: null,
    cadence: null,
    status: "launching",
  },
];

export function getRateCardItem(key: string): RateCardItem | undefined {
  return RATE_CARD.find((r) => r.key === key);
}

export const GB2G_IDENTITY = `GB2GLLC (GloryBe2God LLC) is a faith-rooted but business-first AI software studio. Founded by John — a former Chick-fil-A operator with a banking background — GB2G builds practical AI agents for businesses that understand operations, not VC-lab posturing. Clients keep all code and data.`;

export const GB2G_VOICE_RULES = `Voice: warm, plain-spoken, confident, no jargon, no hype. Do NOT quote scripture in proposal or product context. Write like an operator talking to another operator. Concrete over clever.`;

export const GB2G_BOILERPLATE_TERMS = `- Ownership: the client keeps all code and data we produce for them.
- NDAs: signed on request.
- Engagement: month-to-month for managed services unless a term is specified; one-time builds are fixed-scope with a defined deliverable.`;

export function rateCardForPrompt(): string {
  return RATE_CARD.map((r) => `- ${r.product}: ${r.display} — ${r.summary}`).join("\n");
}
