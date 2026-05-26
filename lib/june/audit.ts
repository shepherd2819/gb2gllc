import { anthropic } from "@/lib/anthropic";

const MODEL = "claude-sonnet-4-6";

export type Opportunity = {
  agent_name: string;       // friendly persona name, e.g. "Jordan"
  product: "Herald" | "Steward" | "Atrium";
  headline: string;         // single-line summary, ~60 chars
  why: string;              // 1-2 sentences why this matters for THIS business
  what_it_does: string[];   // bullet list of concrete actions
  estimated_hours_saved_per_week: number;
};

export type AuditData = {
  company_name: string;
  tagline: string;          // 1-line description of what they do
  what_they_do_summary: string; // 2-3 sentences
  opportunities: Opportunity[];
  closing_note: string;     // warm 1-2 sentence wrap from June
};

export async function generateAudit(scrape: {
  url: string;
  title: string;
  description: string;
  text: string;
}): Promise<AuditData> {
  const system = `You are June, a real-estate-experienced AI strategy analyst at GB2GLLC. Your job is to read a business's website and produce a tight, actionable "AI Opportunity Audit" that the business owner can scan in 60 seconds and immediately understand what GB2G could do for them.

GB2G ships three product lines:
- **Herald** — conversational AI website agents that greet/qualify/book/handoff (best for high-traffic sites, lead-gen businesses, services with appointment funnels)
- **Steward** — AI employees that live inside platforms the business already uses (Slack, Gmail, Monday, Notion, IG/FB) and handle internal ops, research, monitoring, customer follow-ups
- **Atrium** — modern website builds with AI-assist for businesses outgrowing their current site

You will respond with ONLY a single valid JSON object matching this exact schema (no preamble, no markdown fences):
{
  "company_name": string,
  "tagline": string,            // 1-line, like a business-card subtitle
  "what_they_do_summary": string, // 2-3 sentences, in plain language
  "opportunities": [            // 3-5 items, ranked by impact for this specific business
    {
      "agent_name": string,           // a human-sounding first name, fits the persona ("Mark", "June", "Sam", "Liz")
      "product": "Herald" | "Steward" | "Atrium",
      "headline": string,             // ~60 chars, e.g. "After-hours lead qualifier for new property inquiries"
      "why": string,                  // 1-2 sentences — refer to SPECIFICS from their site
      "what_it_does": [string, string, string],  // 3 concrete actions
      "estimated_hours_saved_per_week": number  // realistic, 2-20 range
    }
  ],
  "closing_note": string         // warm, ~2 sentences. Sound like a real person who actually read the site.
}

Rules:
- Reference specific details from the website in "why" — services they offer, audiences they serve, language they use. Generic recommendations are unacceptable.
- "agent_name" must be a different real-sounding first name per opportunity (not "Bot", not "Assistant").
- Be honest. If the business looks like a poor fit for one of the products, skip it — better 3 strong recommendations than 5 generic ones.
- Sound human in the writing. No "leverage", no "synergy", no "unlock potential", no "AI-powered solutions".`;

  const userMessage = `Website: ${scrape.url}
Title: ${scrape.title || "(no title tag)"}
Meta description: ${scrape.description || "(none)"}

Homepage text (first ${scrape.text.length} chars):
"""
${scrape.text}
"""

Produce the JSON audit now.`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2_000,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = (res.content[0]?.type === "text" ? res.content[0].text : "").trim();
  const jsonStr = text.startsWith("```")
    ? text.replace(/^```(?:json)?/, "").replace(/```$/, "").trim()
    : text;

  let parsed: AuditData;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Claude returned non-JSON audit: ${text.slice(0, 200)}`);
  }
  if (!parsed.company_name || !Array.isArray(parsed.opportunities) || parsed.opportunities.length === 0) {
    throw new Error("Audit JSON missing required fields");
  }
  return parsed;
}
