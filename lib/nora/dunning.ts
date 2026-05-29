import { anthropic } from "@/lib/anthropic";
import type { Classified } from "./classify";

const MODEL = "claude-haiku-4-5-20251001";

export type DunningDraft = {
  to: string;
  subject: string;
  body: string;
  model: string;
};

export type DunningInput = {
  classified: Classified;
  customer: { name: string | null; email: string };
  business_name: string;          // e.g. "GB2GLLC"
  voice_notes: string | null;
  signature: string | null;
  invoice_hosted_url: string | null;  // if available, links the customer to update payment method
};

export async function draftDunning(input: DunningInput): Promise<DunningDraft> {
  const cat = input.classified.category;
  const firstName = input.customer.name?.split(/\s+/)[0] ?? null;

  const purposeLine = (() => {
    switch (cat) {
      case "payment_failed":        return "their most recent payment didn't go through";
      case "subscription_past_due": return "their subscription is currently past due";
      default:                      return "their account needs attention";
    }
  })();

  const sys = `You are Nora, an accounts-receivable assistant for ${input.business_name}. Write a single short, warm, professional dunning email to a customer whose ${purposeLine}.

Voice & format rules:
- Plain text, no markdown.
- 4-7 short sentences. No fluff. No "Dear Customer" — use first name if known, otherwise no salutation.
- Lead with empathy, then make the ask crystal clear (update payment method / retry).
- ${input.invoice_hosted_url ? `Include this exact link the customer can click to fix it: ${input.invoice_hosted_url}` : "Do NOT invent a payment link — instead, tell the customer they'll get a Stripe link separately or to reply to this email."}
- Never threaten service cutoff or use legalese.
- DO NOT include a signature — one is appended automatically.
- Sign-off should be a friendly one-liner ending the body (the signature follows on a new line).

${input.voice_notes ? `\nFounder voice notes:\n${input.voice_notes}\n` : ""}

Return ONLY a single JSON object. No preamble.

{
  "subject": "<email subject>",
  "body": "<plain text body>"
}`;

  const user = `Draft the dunning email.

Customer name: ${firstName ?? "(unknown)"}
Customer email: ${input.customer.email}
Stripe event: ${cat}
Stripe summary: ${input.classified.summary}

JSON only.`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: sys,
    messages: [{ role: "user", content: user }],
  });

  const raw = (res.content as unknown[])
    .filter((c): c is { type: string; text: string } => typeof c === "object" && c !== null && (c as { type?: string }).type === "text" && typeof (c as { text?: unknown }).text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim();
  const jsonStr = raw.startsWith("```") ? raw.replace(/^```(?:json)?/, "").replace(/```$/, "").trim() : raw;

  let parsed: { subject?: string; body?: string };
  try { parsed = JSON.parse(jsonStr); }
  catch { throw new Error(`Nora dunning drafter returned non-JSON: ${raw.slice(0, 200)}`); }

  let body = (parsed.body ?? "").trim();
  if (body && input.signature?.trim()) body = `${body}\n\n${input.signature.trim()}`;

  return {
    to: input.customer.email,
    subject: (parsed.subject ?? "About your recent payment").trim(),
    body,
    model: MODEL,
  };
}

export const DUNNING_MODEL_NAME = MODEL;
