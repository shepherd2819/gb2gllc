import { anthropic } from "@/lib/anthropic";
import type { LeadEnrichment } from "./scrape-lead";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1_200;

export type DraftInput = {
  lead: {
    name?: string | null;
    email?: string | null;
    company?: string | null;
    website?: string | null;
    notes?: string | null;
  };
  enrichment: LeadEnrichment | null;
  briefing: {
    briefing_text?: string | null;     // pasted markdown / plain text
    briefing_pdf?: string | null;      // extracted text from PDF
  };
  senderName: string;                  // for sign-off
};

export type DraftOutput =
  | { ok: true; subject: string; body: string; tokens: number; model: string }
  | { ok: false; error: string };

export async function draftOutreachEmail(input: DraftInput): Promise<DraftOutput> {
  const { lead, enrichment, briefing, senderName } = input;

  const briefingBlock = [
    briefing.briefing_text ? `BRIEFING (pasted):\n${briefing.briefing_text}` : null,
    briefing.briefing_pdf  ? `BRIEFING (from PDF):\n${briefing.briefing_pdf}` : null,
  ].filter(Boolean).join("\n\n---\n\n");

  const leadBlock = [
    lead.name    ? `Name: ${lead.name}`       : null,
    lead.company ? `Company: ${lead.company}` : null,
    lead.email   ? `Email: ${lead.email}`     : null,
    lead.website ? `Website: ${lead.website}` : null,
    lead.notes   ? `Notes from admin: ${lead.notes}` : null,
  ].filter(Boolean).join("\n");

  const enrichmentBlock = enrichment ? [
    `Page title: ${enrichment.page_title || "(none)"}`,
    `Meta description: ${enrichment.page_description || "(none)"}`,
    enrichment.contact_form_url ? `Contact form found at: ${enrichment.contact_form_url}` : null,
    "",
    "Homepage text (truncated):",
    enrichment.scraped_text || "(nothing scraped)",
  ].filter(Boolean).join("\n") : "(could not scrape their site)";

  const system = `You are an outbound sales writer at GloryBe2God LLC (GB2G), an AI software studio. You draft personalized cold outreach emails for prospects.

The emails you write must:
- Open with a single specific observation about THIS prospect (their business, services, or words from their site). Never "I hope this finds you well."
- State why GB2G might be useful in ONE concrete sentence tied to their specific situation.
- Include exactly one clear call to action — a question or a low-friction next step.
- Be 80-130 words MAX. Short, scannable, sound like a real person wrote it.
- Sign off with: ${senderName}
- No subject-line clichés ("Quick question", "Following up", "Hey"). The subject must reference something specific about their business.
- No "in today's fast-paced world", "leverage", "synergy", "unlock", "I came across your company".

Output ONLY a single valid JSON object matching this schema:
{
  "subject": string,    // 4-9 words, specific to the prospect
  "body": string        // the email body, plain text, line breaks between paragraphs
}

No preamble, no markdown fences, no commentary.`;

  const userMessage = `Briefing about GB2G's offer (use this to know what to pitch):
${briefingBlock || "(no briefing provided — be conservative and lead with a question)"}

---

Lead details:
${leadBlock}

---

What we scraped from their website:
${enrichmentBlock}

---

Now write the personalized email as JSON.`;

  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: userMessage }],
    });
    const raw = (res.content[0]?.type === "text" ? res.content[0].text : "").trim();
    const jsonStr = raw.startsWith("```") ? raw.replace(/^```(?:json)?/, "").replace(/```$/, "").trim() : raw;

    let parsed: { subject?: string; body?: string };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return { ok: false, error: `Drafter returned non-JSON: ${raw.slice(0, 200)}` };
    }
    if (!parsed.subject || !parsed.body) {
      return { ok: false, error: "Drafter response missing subject or body" };
    }
    return {
      ok: true,
      subject: parsed.subject.trim(),
      body: parsed.body.trim(),
      tokens: (res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0),
      model: MODEL,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
