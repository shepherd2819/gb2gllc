// lib/analytics/insights.ts
//
// Auto-insights: deterministic candidate rules turn snapshot numbers into
// verifiable one-line facts; claude-sonnet-4-6 rewrites those facts into 3-5
// short narrative cards. Strict JSON contract with fence-strip + validation;
// any failure degrades to [] — the dashboard simply shows no cards. The
// anthropic client is lazy-imported inside generateInsights so the pure
// exports (findCandidates, parseInsights) are testable without
// ANTHROPIC_API_KEY.

import type { SnapshotPayload } from "./snapshot";

export type InsightCard = { title: string; body: string; tone: "up" | "down" | "neutral" };

export const INSIGHTS_MODEL = "claude-sonnet-4-6";

const MOM_THRESHOLD = 0.1; // MoM movers beyond ±10%
const MIX_THRESHOLD = 0.3; // product > 30% of mix
const COMPANY_THRESHOLD = 0.25; // top company > 25% of trailing-3-month revenue
const MAX_CARDS = 5;
const TITLE_MAX = 60;
const BODY_MAX = 240;
const TONES = ["up", "down", "neutral"] as const;

function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtPct(r: number): string {
  return `${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}%`;
}

export function findCandidates(payload: SnapshotPayload): string[] {
  const facts: string[] = [];
  const { kpis, trend, productMix, topCompanies } = payload;

  if (kpis.revenueMoM !== null && Math.abs(kpis.revenueMoM) > MOM_THRESHOLD) {
    facts.push(
      `Revenue this month is ${fmtMoney(kpis.revenueThisMonth)}, ${fmtPct(kpis.revenueMoM)} month-over-month.`,
    );
  }
  if (kpis.ordersMoM !== null && Math.abs(kpis.ordersMoM) > MOM_THRESHOLD) {
    facts.push(
      `Orders this month are ${kpis.ordersThisMonth}, ${fmtPct(kpis.ordersMoM)} month-over-month.`,
    );
  }

  const nonZero = trend.filter((t) => t.revenue > 0);
  if (nonZero.length >= 2) {
    const best = nonZero.reduce((a, b) => (b.revenue > a.revenue ? b : a));
    const worst = nonZero.reduce((a, b) => (b.revenue < a.revenue ? b : a));
    if (best.month !== worst.month) {
      facts.push(
        `Best month in the trailing 13: ${best.month}, ${fmtMoney(best.revenue)} revenue on ${best.orders} orders.`,
      );
      facts.push(
        `Worst month in the trailing 13: ${worst.month}, ${fmtMoney(worst.revenue)} revenue on ${worst.orders} orders.`,
      );
    }
  }

  const mixTotal = productMix.reduce((sum, p) => sum + p.revenue, 0);
  if (mixTotal > 0) {
    for (const p of productMix) {
      if (p.name === "Other") continue; // long-tail bucket, not a product
      const share = p.revenue / mixTotal;
      if (share > MIX_THRESHOLD) {
        facts.push(
          `${p.name} is ${(share * 100).toFixed(1)}% of product revenue over the trailing 3 months (${fmtMoney(p.revenue)} of ${fmtMoney(mixTotal)}).`,
        );
      }
    }
  }

  const trailing3Revenue = trend.slice(-3).reduce((sum, t) => sum + t.revenue, 0);
  if (topCompanies.length > 0 && trailing3Revenue > 0) {
    const top = topCompanies[0];
    const share = top.revenue / trailing3Revenue;
    if (share > COMPANY_THRESHOLD) {
      facts.push(
        `${top.name} is the largest customer: ${(share * 100).toFixed(1)}% of trailing-3-month revenue (${fmtMoney(top.revenue)} across ${top.orders} orders).`,
      );
    }
  }

  return facts;
}

export function parseInsights(raw: string): InsightCard[] {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const cards: InsightCard[] = [];
  for (const item of parsed) {
    if (cards.length >= MAX_CARDS) break;
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim().slice(0, TITLE_MAX) : "";
    const body = typeof o.body === "string" ? o.body.trim().slice(0, BODY_MAX) : "";
    if (!title || !body) continue;
    const tone = (TONES as readonly string[]).includes(o.tone as string)
      ? (o.tone as InsightCard["tone"])
      : "neutral";
    cards.push({ title, body, tone });
  }
  return cards;
}

const SYSTEM = `You turn verified business-analytics facts into short narrative insight cards for a client dashboard.

Rules:
- Use ONLY the facts provided. Never invent numbers, trends, or causes.
- Cite the actual numbers from the facts in every card.
- Write 3 to 5 cards. Each card: "title" (max 60 characters), "body" (1-2 plain sentences, max 240 characters), "tone" ("up" for good news, "down" for concerning, "neutral" otherwise).
- Plain business language. No hype, no advice beyond what the numbers show.

Return ONLY a JSON array of {"title": "...", "body": "...", "tone": "up|down|neutral"} objects. No prose, no markdown fences.`;

export async function generateInsights(payload: SnapshotPayload): Promise<InsightCard[]> {
  const candidates = findCandidates(payload);
  if (candidates.length < 2) return [];
  try {
    const { anthropic } = await import("@/lib/anthropic");
    const res = await anthropic.messages.create({
      model: INSIGHTS_MODEL,
      max_tokens: 1000,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Facts (as of ${payload.generatedAt}):\n${candidates.map((c) => `- ${c}`).join("\n")}\n\nJSON array only.`,
        },
      ],
    });
    const raw = res.content[0]?.type === "text" ? res.content[0].text : "";
    return parseInsights(raw);
  } catch {
    return [];
  }
}
