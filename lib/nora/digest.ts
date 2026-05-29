import { anthropic } from "@/lib/anthropic";
import type { StripeMetrics } from "./stripe";

const MODEL = "claude-haiku-4-5-20251001";

export type DigestInput = {
  metrics: StripeMetrics;
  prev_metrics: StripeMetrics | null;          // last week's snapshot, for week-over-week deltas
  monthly_burn_cents: number | null;           // user-supplied burn estimate
  business_name: string;
  voice_notes: string | null;
  period_start: string;                        // ISO
  period_end: string;
};

export async function writeWeeklyDigest(input: DigestInput): Promise<string> {
  const m = input.metrics;
  const p = input.prev_metrics;
  const runway = computeRunway(m, input.monthly_burn_cents);

  const sys = `You are Nora. Write a short weekly cash digest for ${input.business_name}. Tone: calm, founder-friendly, specific about numbers, never alarmist. Use plain markdown — H2 for sections, bullets for lists. No emoji-heavy headers. End with one short sentence the founder can act on this week (or "Nothing on fire — good week.").

${input.voice_notes ? `\nFounder voice notes:\n${input.voice_notes}\n` : ""}

Sections (use only those that have data):
## Cash position
## Revenue this week
## What needs attention
## Top customers
## What to do this week

Return only the markdown body.`;

  const user = `Build the digest from these metrics.

Period: ${formatRange(input.period_start, input.period_end)}

THIS WEEK (collected ${m.collected_at})
─────────
Balance available:        ${money(m.balance_available_cents, m.currency)}
Balance pending:          ${money(m.balance_pending_cents, m.currency)}
MRR:                      ${money(m.mrr_cents, m.currency)}
Active subscriptions:     ${m.active_subscriptions}
Past-due subscriptions:   ${m.past_due_subscriptions}
Canceled last 30d:        ${m.canceled_last_30d}
Successful charges 7d:    ${m.successful_payments_last_7d.count} totaling ${money(m.successful_payments_last_7d.total_cents, m.currency)}
Failed charges 7d:        ${m.failed_payments_last_7d.count} totaling ${money(m.failed_payments_last_7d.total_cents, m.currency)}
Refunds 7d:               ${m.refunds_last_7d.count} totaling ${money(m.refunds_last_7d.total_cents, m.currency)}
Open disputes:            ${m.disputes_open}
${runway ? `Estimated runway:         ${runway}` : ""}

${m.top_customers.length > 0 ? `Top customers by MRR:\n${m.top_customers.map((c) => `  • ${c.name}${c.email ? ` <${c.email}>` : ""} — ${money(c.mrr_cents, m.currency)}/mo`).join("\n")}` : ""}

${p ? `LAST WEEK FOR DELTA
─────────
MRR:                ${money(p.mrr_cents, p.currency)} (${pctDelta(p.mrr_cents, m.mrr_cents)})
Active subs:        ${p.active_subscriptions} → ${m.active_subscriptions}
Successful charges: ${p.successful_payments_last_7d.count} → ${m.successful_payments_last_7d.count}
Failed charges:     ${p.failed_payments_last_7d.count} → ${m.failed_payments_last_7d.count}
` : "(no prior week to compare)"}

Write the digest now. Markdown only.`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1_500,
    system: sys,
    messages: [{ role: "user", content: user }],
  });

  return (res.content as unknown[])
    .filter((c): c is { type: string; text: string } => typeof c === "object" && c !== null && (c as { type?: string }).type === "text" && typeof (c as { text?: unknown }).text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

export const DIGEST_MODEL_NAME = MODEL;

// ─── Helpers ────────────────────────────────────────────────────────────
function money(cents: number, currency: string): string {
  const c = currency.toUpperCase();
  const sym = c === "USD" ? "$" : c === "EUR" ? "€" : c === "GBP" ? "£" : "";
  const amt = Math.abs(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? "-" : ""}${sym}${amt}${sym ? "" : ` ${c}`}`;
}
function pctDelta(prev: number, curr: number): string {
  if (prev === 0) return curr === 0 ? "no change" : "new";
  const pct = ((curr - prev) / prev) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}% week-over-week`;
}
function formatRange(start: string, end: string): string {
  const s = new Date(start), e = new Date(end);
  return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}
function computeRunway(m: StripeMetrics, monthlyBurnCents: number | null): string | null {
  if (!monthlyBurnCents || monthlyBurnCents <= 0) return null;
  const cashCents = m.balance_available_cents + m.balance_pending_cents;
  const netBurnCents = monthlyBurnCents - m.mrr_cents;
  if (netBurnCents <= 0) return "MRR exceeds monthly burn (cash positive)";
  const months = cashCents / netBurnCents;
  if (months > 36) return ">36 months";
  return `~${months.toFixed(1)} months`;
}
