import { anthropic } from "@/lib/anthropic";
import { supabaseAdmin } from "@/lib/supabase";

// Holt's research pass. For each external attendee we want to know:
//   - their role / company
//   - recent public activity (LinkedIn posts, blog, press, funding)
//   - what their company does + recent news
//
// We use Claude's server-side web_search tool so it can iteratively search,
// dedupe, and synthesize in one round trip. Output is a structured JSON
// blob we hand to the briefing writer.
//
// Cost target: ~$0.03-0.05 per meeting (Sonnet + a few searches).

const RESEARCH_MODEL = "claude-sonnet-4-6";

export type AttendeeResearch = {
  email: string;
  name: string | null;
  company: string | null;
  role: string | null;
  linkedin_url: string | null;
  about: string;                 // 2-3 sentence summary
  recent_signals: string[];      // bullet points: posts, news, funding, hires, product launches
  sources: { title: string; url: string }[];
};

export type PriorThread = {
  subject: string;
  from_email: string | null;
  snippet: string | null;
  body_text: string | null;
  received_at: string;
};

// Pull the last N emails from/to this attendee out of Iris's inbox table,
// if Iris is connected for this WorkOS user. Cheap, fast context.
export async function getPriorThreads(workosUserId: string, attendeeEmail: string, limit = 5): Promise<PriorThread[]> {
  // Look up the user's Iris accounts; pull messages where from_email matches
  // OR where the attendee was on the to_addresses array.
  const { data: irisAccounts } = await supabaseAdmin
    .from("iris_inbox_accounts")
    .select("id")
    .eq("workos_user_id", workosUserId);
  const accountIds = (irisAccounts ?? []).map((a) => a.id);
  if (accountIds.length === 0) return [];

  const { data } = await supabaseAdmin
    .from("iris_messages")
    .select("subject, from_email, snippet, body_text, received_at, to_addresses")
    .in("account_id", accountIds)
    .or(`from_email.eq.${attendeeEmail.toLowerCase()},to_addresses.cs.{${attendeeEmail.toLowerCase()}}`)
    .order("received_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((m: { subject: string | null; from_email: string | null; snippet: string | null; body_text: string | null; received_at: string }) => ({
    subject: m.subject ?? "(no subject)",
    from_email: m.from_email,
    snippet: m.snippet,
    body_text: m.body_text,
    received_at: m.received_at,
  }));
}

export async function researchAttendee(opts: {
  email: string;
  name: string | null;
  companyHint: string | null;
  webSearchEnabled: boolean;
}): Promise<AttendeeResearch> {
  // No web research mode → return a stub so the briefing still renders.
  if (!opts.webSearchEnabled) {
    return {
      email: opts.email,
      name: opts.name,
      company: opts.companyHint,
      role: null,
      linkedin_url: null,
      about: "",
      recent_signals: [],
      sources: [],
    };
  }

  const system = `You are a research analyst preparing a one-page briefing for a meeting. Your job: find publicly available info on a single person and their company.

Use web_search iteratively. Aim for 2-4 targeted searches. Prioritize:
1. LinkedIn profile (find the URL)
2. Their current role + company
3. Their recent activity: LinkedIn posts in the last ~60 days, blog posts, press mentions, conference talks, funding announcements
4. What their company does, stage, recent news

Return ONLY a single JSON object matching this schema. No prose, no markdown fences.

{
  "name": string | null,
  "company": string | null,
  "role": string | null,
  "linkedin_url": string | null,
  "about": "<2-3 sentence summary of the person AND what their company does>",
  "recent_signals": [ "<bullet point>", ... ],     // 3-6 bullets max
  "sources": [ { "title": string, "url": string }, ... ]  // 3-5 cited URLs
}

Rules:
- DO NOT fabricate. If you can't find something, use null or omit the bullet.
- Prefer first-party sources (their LinkedIn, their company site) over third-party blogs.
- recent_signals should be factual ("Raised $4M seed in Feb 2026 — TechCrunch") not speculative.
- Skip stale info (>12 months unless it's foundational like "founded company in 2019").`;

  const user = `Research this person for an upcoming meeting:

Email: ${opts.email}
Name (from calendar invite): ${opts.name ?? "(not provided)"}
Company hint (from email domain): ${opts.companyHint ?? "(unknown)"}

Search the web. Return JSON only.`;

  try {
    const res = await anthropic.messages.create({
      model: RESEARCH_MODEL,
      max_tokens: 2_000,
      system,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      messages: [{ role: "user", content: user }],
    });

    // Pull the final text block (after any tool_use rounds).
    const finalText = (res.content as unknown[])
      .filter((c): c is { type: string; text: string } => typeof c === "object" && c !== null && (c as { type?: string }).type === "text" && typeof (c as { text?: unknown }).text === "string")
      .map((c) => c.text)
      .join("\n")
      .trim();

    const jsonStr = finalText.startsWith("```")
      ? finalText.replace(/^```(?:json)?/, "").replace(/```$/, "").trim()
      : finalText;

    const parsed = JSON.parse(jsonStr) as Partial<AttendeeResearch>;
    return {
      email: opts.email,
      name: parsed.name ?? opts.name,
      company: parsed.company ?? opts.companyHint,
      role: parsed.role ?? null,
      linkedin_url: parsed.linkedin_url ?? null,
      about: parsed.about ?? "",
      recent_signals: Array.isArray(parsed.recent_signals) ? parsed.recent_signals.slice(0, 8) : [],
      sources: Array.isArray(parsed.sources) ? parsed.sources.slice(0, 6) : [],
    };
  } catch (err) {
    // Research is best-effort. On failure we still want to ship a brief with
    // whatever calendar + prior-email context we have.
    return {
      email: opts.email,
      name: opts.name,
      company: opts.companyHint,
      role: null,
      linkedin_url: null,
      about: `(research failed: ${err instanceof Error ? err.message : String(err)})`,
      recent_signals: [],
      sources: [],
    };
  }
}
