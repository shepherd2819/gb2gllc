// lib/wren/classify.ts
//
// Wren — support-mailbox triage classifier + drafter. Mirrors lib/iris/classify.ts
// in shape but tuned for support emails: support-specific category set, warm
// client-context injection, and the Speak-to-Support CTA appended between
// draft body and signature.

import { anthropic } from "@/lib/anthropic";
import { supportFooterText } from "@/lib/email-footer";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1_500;

export const CATEGORIES = [
  "bug",
  "feature_request",
  "account_help",
  "billing_question",
  "general",
  "spam",
] as const;

export const PRIORITIES = ["high", "med", "low"] as const;

export type Classification = {
  category: (typeof CATEGORIES)[number];
  priority: (typeof PRIORITIES)[number];
  reasoning: string;
  suggested_action: string;
  draft_reply: string;
};

export type MatchedClient = {
  id: string;
  name: string | null;
  company: string | null;
  active_products: string[];
  recent_logs_summary: string | null;
};

export type ClassifyInput = {
  from_email: string;
  from_name: string | null;
  delivered_to: string | null;
  subject: string;
  body_text: string;
  voice_notes?: string;
  signature?: string;
  draft_categories: string[];
  matched_client?: MatchedClient | null;
};

/** Defensively normalize a possibly-malformed model response. Used by the classifier and by tests. */
export function normalizeClassification(raw: Partial<Classification> | Record<string, unknown>): Classification {
  const cat = String(raw.category ?? "").toLowerCase();
  const pri = String(raw.priority ?? "").toLowerCase();
  return {
    category: (CATEGORIES as readonly string[]).includes(cat)
      ? (cat as Classification["category"])
      : "general",
    priority: (PRIORITIES as readonly string[]).includes(pri)
      ? (pri as Classification["priority"])
      : "low",
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning.trim() : "",
    suggested_action: typeof raw.suggested_action === "string" ? raw.suggested_action.trim() : "",
    draft_reply: typeof raw.draft_reply === "string" ? raw.draft_reply : "",
  };
}

/**
 * Assemble the final draft body that gets written to the Gmail draft:
 * `{model draft}\n\n{CTA footer}\n\n{signature}`
 *
 * - Strips the model's well-meaning sign-off (Best/Thanks/Cheers/etc.) since we
 *   always append our own signature and double sign-offs look silly.
 * - Returns "" if the input draft is empty/whitespace.
 */
export function finalizeDraftBody(draft: string, signature: string | undefined): string {
  // Strip a real sign-off without eating a legit "Thanks!" paragraph.
  // Two shapes count as sign-offs:
  //   (a) Named word followed by comma+newline: "Best,\nJohn", "Thanks,\nWren", etc.
  //   (b) Divider line: "—" or "--" optionally followed by whitespace and a newline,
  //       or with a signature on the same line ("— Wren").
  // A word like "Thanks!" followed by sentence continuation no longer matches.
  let body = draft.replace(
    /\n+(?:(?:best|thanks|thank you|cheers|sincerely|warmly|regards)\s*,\s*\n|(?:—|--)\s*\n?)[\s\S]*$/i,
    ""
  ).trim();
  if (!body) return "";
  body = `${body}\n${supportFooterText()}`;
  if (signature?.trim()) body = `${body}\n\n${signature.trim()}`;
  return body;
}

export async function classifyAndDraft(input: ClassifyInput): Promise<Classification> {
  const system = `You are Wren, a support-mailbox triage agent for GB2GLLC (a faith-rooted, business-first AI software studio). For every incoming support email:

1. Classify it into ONE category from this exact list:
   ${CATEGORIES.join(", ")}

2. Assign a priority:
   - high → needs a same-day human reply (paying customer in trouble, outage, time-sensitive ask)
   - med  → reply within a few days (normal support question, account question)
   - low  → can wait or doesn't need a reply (FYI, vague follow-up, spam)

3. Write a one-sentence "suggested_action" (e.g. "Reply with reset instructions", "Investigate bug", "Archive — spam", "Escalate to founder").

4. If the category is one of: ${input.draft_categories.join(", ")} — AND a reply is actually warranted — write a "draft_reply" body. Otherwise return "" for draft_reply.

Draft-reply rules:
- Plain text. No markdown, no bullet points unless natural.
- GB2G voice: warm, direct, plain-spoken. No jargon, no hype. No exclamation points unless the sender used them first.
- Address the sender by first name if known.
- DO NOT invent commitments, pricing, calendar slots, links, or specifics not in the original email or warm-client context. If you'd need info you don't have, write a short reply that asks for it.
- DO NOT include a signature — one will be appended automatically.
- Length: 2–5 sentences for most. Longer only if the sender asked multiple distinct questions.
- If the email is hostile, legal, asks for a refund, or is clearly outside what a polite assistant should answer without the founder, leave draft_reply as "" and set suggested_action to "Founder must reply personally".

${input.matched_client ? `Warm client context (this sender is a known client):
- Name: ${input.matched_client.name ?? "(unknown)"}
- Company: ${input.matched_client.company ?? "(unknown)"}
- Active products: ${input.matched_client.active_products.join(", ") || "(none)"}
- Recent activity: ${input.matched_client.recent_logs_summary ?? "(none)"}
Use this context to ground the reply, but don't recite it back at them.\n` : ""}
Voice notes from the founder:
${input.voice_notes?.trim() || "(none — use default warm/direct style)"}

Return ONLY a single valid JSON object. No prose, no markdown fences.

{
  "category": "${CATEGORIES.join(" | ")}",
  "priority": "${PRIORITIES.join(" | ")}",
  "reasoning": "<1-2 sentence explanation of category + priority>",
  "suggested_action": "<short imperative phrase>",
  "draft_reply": "<body text OR empty string>"
}`;

  const userMsg = `From: ${input.from_name ?? "(no name)"} <${input.from_email}>
To (alias hit): ${input.delivered_to ?? "(unknown)"}
Subject: ${input.subject || "(no subject)"}

----- BODY -----
${input.body_text.slice(0, 8_000)}
----- END BODY -----

Classify and (if appropriate) draft. JSON only.`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: userMsg }],
  });

  const raw = (res.content[0]?.type === "text" ? res.content[0].text : "").trim();
  const jsonStr = raw.startsWith("```")
    ? raw.replace(/^```(?:json)?/, "").replace(/```$/, "").trim()
    : raw;

  let parsed: Partial<Classification>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Wren classifier returned non-JSON: ${raw.slice(0, 200)}`);
  }

  const normalized = normalizeClassification(parsed);
  return {
    ...normalized,
    draft_reply: finalizeDraftBody(normalized.draft_reply, input.signature),
  };
}

export const MODEL_NAME = MODEL;
