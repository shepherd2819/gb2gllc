import { anthropic } from "@/lib/anthropic";

// Haiku is more than good enough for triage + a competent reply draft and
// keeps cost ~$0.005/email at typical sizes. Sonnet 4.6 would be 20x for
// marginal quality gain on this task.
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1_500;

export const CATEGORIES = [
  "lead",            // potential customer / inbound interest
  "support",         // existing customer asking for help
  "internal",        // teammate / contractor / dev
  "newsletter",      // marketing emails, digests, "this week in X"
  "calendar",        // meeting invites, Calendly confirmations, reschedules
  "spam",            // junk, phishing, mass cold outreach
  "personal",        // friend / family / non-business
  "other",
] as const;

export const PRIORITIES = ["high", "med", "low"] as const;

export type Classification = {
  category: (typeof CATEGORIES)[number];
  priority: (typeof PRIORITIES)[number];
  reasoning: string;
  suggested_action: string;
  draft_reply: string;             // empty string if no draft warranted
};

export type ClassifyInput = {
  from_email: string;
  from_name: string | null;
  delivered_to: string | null;     // which alias received it
  subject: string;
  body_text: string;
  recent_thread_subjects?: string[]; // optional: prior subject lines from same sender (anti-repetition)
  voice_notes?: string;            // user's per-account voice guidance
  signature?: string;              // appended to draft_reply if non-empty
  draft_categories: string[];      // categories where Iris is allowed to draft
};

export async function classifyAndDraft(input: ClassifyInput): Promise<Classification> {
  const system = `You are Iris, an inbox-triage agent for the founder of GB2GLLC (an AI software studio). Your job, for every incoming email:

1. Classify it into ONE category from this exact list:
   ${CATEGORIES.join(", ")}

2. Assign a priority:
   - high  → needs a same-day human reply (hot lead, paying customer in trouble, time-sensitive ask)
   - med   → reply within a few days (warm intro, normal support question, internal request)
   - low   → can wait or doesn't need a reply (newsletters, FYIs, automated notifications)

3. Write a one-sentence "suggested_action" (e.g. "Reply with intro deck", "Forward to finance", "Archive — newsletter", "Schedule a call").

4. If the category is one of: ${input.draft_categories.join(", ")} — AND a reply is actually warranted — write a "draft_reply" body. Otherwise return "" for draft_reply.

Draft-reply rules:
- Plain text, no markdown, no bullet points unless natural.
- Match the founder's voice: warm, direct, no fluff. Short paragraphs. No exclamation points unless the sender used them first.
- Address the sender by first name if known. If not, no salutation.
- DO NOT invent commitments, calendar slots, pricing, links, or specifics that weren't in the original email. If you'd need info you don't have, write a short reply that asks for it.
- DO NOT include a signature — one will be appended automatically.
- Length: 2-5 sentences for most. Longer only if the sender asked multiple distinct questions.
- If the email is hostile, legal, asks for a refund, or is clearly outside what a polite assistant should answer without the founder, leave draft_reply as "" and set suggested_action to "Founder must reply personally".

Voice notes from the founder (apply these to the draft):
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
${input.recent_thread_subjects?.length ? `\nPrior subject lines from this sender:\n${input.recent_thread_subjects.slice(0, 5).map((s) => `  • ${s}`).join("\n")}` : ""}

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
    throw new Error(`Iris classifier returned non-JSON: ${raw.slice(0, 200)}`);
  }

  const category = (CATEGORIES as readonly string[]).includes(parsed.category ?? "")
    ? (parsed.category as Classification["category"])
    : "other";
  const priority = (PRIORITIES as readonly string[]).includes(parsed.priority ?? "")
    ? (parsed.priority as Classification["priority"])
    : "low";

  let draft = (parsed.draft_reply ?? "").trim();
  // Strip the model's well-meaning sign-off if it included one — we always
  // append the user's configured signature, and double sign-offs look silly.
  draft = draft.replace(/\n+(best|thanks|thank you|cheers|sincerely|warmly|regards|—|--)[\s\S]*$/i, "").trim();
  if (draft && input.signature?.trim()) draft = `${draft}\n\n${input.signature.trim()}`;

  return {
    category,
    priority,
    reasoning: (parsed.reasoning ?? "").trim(),
    suggested_action: (parsed.suggested_action ?? "").trim(),
    draft_reply: draft,
  };
}

export const MODEL_NAME = MODEL;
