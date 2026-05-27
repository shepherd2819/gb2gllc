import { anthropic } from "@/lib/anthropic";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2_000;

// Maps to the existing intake state shape in public/intake-app.js so what we
// extract drops straight into the existing form fields after the review step.
export type BrainDumpExtracted = {
  contact:  { name: string; email: string; company: string; website: string };
  about:    { role: string; industry: string; teamSize: string; urgency: string };
  goals:    { selected: string[]; freeText: string };  // selected = GOAL_OPTION ids
  software: { selected: string[]; other: string };      // selected = SOFTWARE_OPTION ids
  tasks:    { title: string; frequency: string; whoDoesItNow: string; dataLives: string }[];
  missing_fields: string[];                              // names of fields we couldn't infer
  confidence: { low: string[]; high: string[] };         // field names with low / high confidence
};

// Keep these in sync with the option IDs the structured form already understands.
// (Used by Claude to pick valid IDs instead of inventing free strings.)
const GOAL_OPTIONS = [
  "save-time-ops", "qualify-leads", "support-tickets", "internal-knowledge",
  "content-drafting", "social-replies", "research-monitoring", "customer-followups",
  "data-entry", "reporting", "other",
];

// Keep IN SYNC with public/intake-platforms.js — these are the IDs the brain
// dump extractor is allowed to use. Adding new platforms? Add them in BOTH
// places so the structured picker and the AI extractor stay aligned.
const SOFTWARE_OPTIONS = [
  // Email + comms
  "gmail", "m365", "slack", "zoom",
  // Docs + project mgmt
  "notion", "linear", "asana", "trello", "clickup", "jira", "monday",
  // CRM
  "hubspot", "salesforce", "pipedrive", "zoho-crm", "gohighlevel",
  // Data
  "airtable",
  // Ecommerce + payments
  "shopify", "stripe", "square",
  // Accounting
  "quickbooks", "xero",
  // Email marketing
  "mailchimp", "klaviyo", "activecampaign",
  // Scheduling
  "calendly", "acuity", "google-calendar",
  // Docs / forms
  "docusign", "typeform",
  // Support
  "zendesk", "intercom",
  // Field service / vertical
  "jobber", "servicetitan", "spiro",
  // Code + automation
  "github", "zapier",
  // Social (recognized by extractor even without a separate platform entry)
  "linkedin", "facebook", "instagram", "x-twitter",
  // Catch-all
  "other",
];

const TEAM_SIZE_OPTIONS = ["solo", "2-5", "6-15", "16-50", "50+"];
const URGENCY_OPTIONS   = ["asap", "1-month", "1-quarter", "no-rush"];

export async function extractFromBrainDump(text: string): Promise<BrainDumpExtracted> {
  const system = `You are a careful intake-extraction analyst at GB2GLLC. A prospective client has written a freeform "brain dump" about their business and what they want help with. Your job is to extract structured fields from it.

Return ONLY a single valid JSON object matching this exact schema. No preamble, no markdown fences, no commentary.

{
  "contact":  { "name": string, "email": string, "company": string, "website": string },
  "about":    { "role": string, "industry": string, "teamSize": "${TEAM_SIZE_OPTIONS.join(" | ")}" | "", "urgency": "${URGENCY_OPTIONS.join(" | ")}" | "" },
  "goals":    { "selected": (one or more of [${GOAL_OPTIONS.map(s => `"${s}"`).join(", ")}]), "freeText": string },
  "software": { "selected": (one or more of [${SOFTWARE_OPTIONS.map(s => `"${s}"`).join(", ")}]), "other": string },
  "tasks":    [ { "title": string, "frequency": string, "whoDoesItNow": string, "dataLives": string } ],
  "missing_fields": string[],
  "confidence": { "low": string[], "high": string[] }
}

Rules:
- Use empty string "" for any field you cannot infer. Use empty array [] for unfillable lists.
- "selected" arrays must use ONLY the exact IDs listed. If they mention "Gmail and Slack", selected = ["gmail", "slack"]. Anything not in the list goes into "other" as free text.
- "teamSize" must be one of: solo, 2-5, 6-15, 16-50, 50+ (or "" if not mentioned).
- "urgency" must be one of: asap, 1-month, 1-quarter, no-rush (or "" if not mentioned).
- For "tasks": extract every specific task they mention they'd want AI to handle. Be granular. If they say "answer customer emails, then write social posts" that's two tasks. If they don't mention any specific tasks, return [].
- For "missing_fields": list field paths that the brain dump didn't cover, e.g. ["contact.email", "about.teamSize", "tasks"]. This drives the post-review UI.
- For "confidence": "low" = fields you guessed at; "high" = fields you're certain about. Anything you extracted should be in one or the other.
- Be conservative. It is far better to leave a field empty than to invent something the user didn't say.

Output: JSON only.`;

  const userMessage = `Brain dump from the client:
"""
${text.slice(0, 12_000)}
"""

Extract the JSON now.`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  const raw = (res.content[0]?.type === "text" ? res.content[0].text : "").trim();
  const jsonStr = raw.startsWith("```")
    ? raw.replace(/^```(?:json)?/, "").replace(/```$/, "").trim()
    : raw;

  let parsed: BrainDumpExtracted;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Claude returned non-JSON brain-dump extraction: ${raw.slice(0, 200)}`);
  }

  return normalize(parsed);
}

// Defensive: Claude sometimes drops a key or returns slight schema drift.
// Fill in safe defaults so the rest of the pipeline never crashes.
function normalize(d: Partial<BrainDumpExtracted>): BrainDumpExtracted {
  const contact = d.contact ?? { name: "", email: "", company: "", website: "" };
  const about   = d.about   ?? { role: "", industry: "", teamSize: "", urgency: "" };
  const goals   = d.goals   ?? { selected: [], freeText: "" };
  const sw      = d.software ?? { selected: [], other: "" };

  // Drop any selected ids that aren't in the canonical list
  goals.selected   = (goals.selected   ?? []).filter((id) => GOAL_OPTIONS.includes(id));
  sw.selected      = (sw.selected      ?? []).filter((id) => SOFTWARE_OPTIONS.includes(id));
  if (!TEAM_SIZE_OPTIONS.includes(about.teamSize)) about.teamSize = "";
  if (!URGENCY_OPTIONS.includes(about.urgency))    about.urgency = "";

  const tasks = Array.isArray(d.tasks) ? d.tasks.map((t) => ({
    title: t?.title ?? "",
    frequency: t?.frequency ?? "",
    whoDoesItNow: t?.whoDoesItNow ?? "",
    dataLives: t?.dataLives ?? "",
  })) : [];

  return {
    contact: {
      name: contact.name ?? "",
      email: contact.email ?? "",
      company: contact.company ?? "",
      website: contact.website ?? "",
    },
    about: {
      role: about.role ?? "",
      industry: about.industry ?? "",
      teamSize: about.teamSize ?? "",
      urgency: about.urgency ?? "",
    },
    goals: {
      selected: goals.selected,
      freeText: goals.freeText ?? "",
    },
    software: {
      selected: sw.selected,
      other: sw.other ?? "",
    },
    tasks,
    missing_fields: Array.isArray(d.missing_fields) ? d.missing_fields : [],
    confidence: {
      low:  Array.isArray(d.confidence?.low)  ? d.confidence!.low  : [],
      high: Array.isArray(d.confidence?.high) ? d.confidence!.high : [],
    },
  };
}
