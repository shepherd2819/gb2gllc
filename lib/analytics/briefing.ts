// lib/analytics/briefing.ts
//
// AI Executive Briefing: a compact, deterministic fact sheet from the snapshot
// (buildBriefingInput), rewritten by claude-sonnet-4-6 into a 4-6 sentence
// executive narrative citing the real numbers. parseBriefing strips fences /
// quotes, clamps length, and rejects non-prose garbage. Any failure degrades to
// "" — the card simply shows its empty state. The anthropic client is
// lazy-imported inside generateBriefing so the pure exports (buildBriefingInput,
// parseBriefing) are testable without ANTHROPIC_API_KEY. Mirrors insights.ts.

import type { SnapshotPayload } from "./snapshot";

export const BRIEFING_MODEL = "claude-sonnet-4-6";

const MAX_SENTENCES = 6;
const MAX_CHARS = 600;

function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtPct(r: number | null): string {
  if (r === null) return "n/a";
  return `${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}%`;
}

export function buildBriefingInput(payload: SnapshotPayload): string {
  const { kpis, yoy, paceToGoal, trend, productMix, topCompanies } = payload;
  const lines: string[] = [];
  lines.push(`As of: ${payload.generatedAt}`);
  lines.push(
    `Revenue this month: ${fmtMoney(kpis.revenueThisMonth)} (MoM ${fmtPct(kpis.revenueMoM)}, YoY ${fmtPct(yoy.revenueYoY)}).`,
  );
  lines.push(
    `Orders this month: ${kpis.ordersThisMonth} (MoM ${fmtPct(kpis.ordersMoM)}, YoY ${fmtPct(yoy.ordersYoY)}).`,
  );
  lines.push(`Average order value: ${fmtMoney(kpis.avgOrderValue)}.`);
  lines.push(`Active customers this month: ${kpis.activeCustomers}.`);
  if (paceToGoal.basis === "none" || paceToGoal.target === null) {
    lines.push("Pace to goal: no target available.");
  } else {
    lines.push(
      `Pace to goal (${paceToGoal.basis}): ${fmtMoney(paceToGoal.mtd)} month-to-date, projected ${fmtMoney(paceToGoal.projected)} against a target of ${fmtMoney(paceToGoal.target)} (${(paceToGoal.fraction * 100).toFixed(0)}% of target on current pace).`,
    );
  }
  const nonZero = trend.filter((t) => t.revenue > 0);
  if (nonZero.length >= 2) {
    const best = nonZero.reduce((a, b) => (b.revenue > a.revenue ? b : a));
    lines.push(`Best month in the trailing 13: ${best.month} at ${fmtMoney(best.revenue)}.`);
  }
  if (productMix.length > 0) {
    lines.push(
      `Top product by revenue (trailing 3 months): ${productMix[0].name} at ${fmtMoney(productMix[0].revenue)}.`,
    );
  }
  if (topCompanies.length > 0) {
    lines.push(
      `Largest customer (trailing 3 months): ${topCompanies[0].name} at ${fmtMoney(topCompanies[0].revenue)} across ${topCompanies[0].orders} orders.`,
    );
  }
  return lines.join("\n");
}

export function parseBriefing(raw: string): string {
  let text = (raw ?? "").trim();
  if (!text) return "";
  if (text.startsWith("```")) {
    text = text
      .replace(/^```(?:[a-z]*)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      text = text.slice(1, -1).trim();
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.startsWith("{") || text.startsWith("[") || text.startsWith("<")) return "";
  const parts = text.split(/(?<=[.!?])\s+/);
  if (parts.length > MAX_SENTENCES) {
    text = parts.slice(0, MAX_SENTENCES).join(" ").trim();
  }
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS).trim();
  return text;
}

const SYSTEM = `You are an executive analyst writing a short briefing for a business-analytics dashboard.

Rules:
- Use ONLY the facts provided. Never invent numbers, trends, or causes.
- Cite the actual numbers from the facts.
- Write a single paragraph of 4 to 6 plain sentences — an executive narrative of how the business is doing this month.
- Plain business language. No hype, no bullet points, no markdown, no headings, no lists, no advice beyond what the numbers show.

Return ONLY the paragraph text. No preamble, no quotes, no markdown fences.`;

export async function generateBriefing(payload: SnapshotPayload): Promise<string> {
  try {
    const { anthropic } = await import("@/lib/anthropic");
    const res = await anthropic.messages.create({
      model: BRIEFING_MODEL,
      max_tokens: 500,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Facts:\n${buildBriefingInput(payload)}\n\nWrite the executive briefing paragraph now.`,
        },
      ],
    });
    const rawText = res.content[0]?.type === "text" ? res.content[0].text : "";
    return parseBriefing(rawText);
  } catch {
    return "";
  }
}
