import { anthropic } from "@/lib/anthropic";
import type { AttendeeResearch, PriorThread } from "./research";

const BRIEF_MODEL = "claude-sonnet-4-6";

export type BriefInput = {
  event: {
    summary: string;
    start_at: string;        // ISO
    end_at: string | null;
    location: string | null;
    description: string | null;
    timezone: string | null;
  };
  attendees: { research: AttendeeResearch; prior_threads: PriorThread[] }[];
  voice_notes: string | null;
  user_name: string | null;  // for the salutation
};

export async function writeBriefing(input: BriefInput): Promise<string> {
  const sys = `You are Holt, a meeting prep assistant for the founder of GB2GLLC (an AI software studio). Your job is to write a single, scannable, one-page briefing for an upcoming meeting.

Voice & format rules:
- Plain markdown. No HTML, no emoji-heavy headers.
- Reader will skim on their phone 2 hours before the meeting. Optimize for the eye — short paragraphs, tight bullets.
- 2-3 short opening lines that contextualize: who, what they likely want.
- Per-attendee section ONLY if there are 1-2 externals; if 3+, write a single "the room" section with each named in 1 line + the most-important shared signal.
- "Recent signals" = 3-5 bullets max across all attendees. Pick the most newsworthy. Skip if there's nothing relevant.
- "Prior thread context" = if we have prior emails, summarize what was discussed in 2-3 lines. Quote a single key line verbatim if it's load-bearing.
- "What they probably want" = 1 sentence. Stake a confident guess based on signals.
- "Suggested questions" = 3 questions ${input.user_name ? input.user_name : "the founder"} could ask. Make them sharp, specific to the signals, not generic.
- DO NOT pad. If something's empty, omit the section.
- DO NOT cite sources inline; the email template appends them at the bottom.

${input.voice_notes ? `\nFounder voice notes:\n${input.voice_notes}\n` : ""}

Return the markdown body only — no preamble like "Here is the briefing:". Start with the # title.`;

  const startLocal = formatLocalTime(input.event.start_at, input.event.timezone);

  const attendeesBlock = input.attendees.map((a, i) => {
    const r = a.research;
    const priorBlock = a.prior_threads.length
      ? `\nPrior emails (most recent first):\n${a.prior_threads.map((t) => `  • ${formatDate(t.received_at)} — "${t.subject}" — ${(t.snippet ?? t.body_text ?? "").slice(0, 280).replace(/\s+/g, " ")}`).join("\n")}`
      : "\nPrior emails: (none in inbox)";
    return `── Attendee ${i + 1} ──
Email: ${r.email}
Name: ${r.name ?? "(unknown)"}
Role: ${r.role ?? "(unknown)"}
Company: ${r.company ?? "(unknown)"}
LinkedIn: ${r.linkedin_url ?? "(not found)"}

About:
${r.about || "(no public info found)"}

Recent signals:
${r.recent_signals.length ? r.recent_signals.map((s) => `  • ${s}`).join("\n") : "  • (none found)"}
${priorBlock}`;
  }).join("\n\n");

  const user = `Write the briefing for this meeting.

EVENT
─────
Title:      ${input.event.summary || "(no title)"}
When:       ${startLocal}${input.event.end_at ? ` → ${formatLocalTime(input.event.end_at, input.event.timezone)}` : ""}
Location:   ${input.event.location || "(none / video)"}
Description: ${input.event.description ? truncate(input.event.description, 400) : "(none)"}

ATTENDEES (external only — internal teammates are filtered out)
─────────
${attendeesBlock}

Write the brief now. Markdown only.`;

  const res = await anthropic.messages.create({
    model: BRIEF_MODEL,
    max_tokens: 2_500,
    system: sys,
    messages: [{ role: "user", content: user }],
  });

  return extractText(res.content);
}

// ─── Evening digest: short list of tomorrow's externals ─────────────────
export async function writeEveningDigest(opts: {
  meetings: { summary: string; start_at: string; timezone: string | null; attendees_short: string }[];
  user_name: string | null;
  voice_notes: string | null;
}): Promise<string> {
  if (opts.meetings.length === 0) {
    return `## Tomorrow's externals\n\nNothing on the books. Enjoy the focus time.`;
  }

  const sys = `You are Holt. Write a short evening summary of tomorrow's external meetings. Format: a single markdown section. One line per meeting. Friendly, brief, no fluff. End with a one-line sign-off matching the founder's voice notes if provided.`;

  const list = opts.meetings.map((m) => `${formatLocalTime(m.start_at, m.timezone)} — ${m.summary} — ${m.attendees_short}`).join("\n");

  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",     // Haiku is plenty for a one-line-per-meeting digest
    max_tokens: 600,
    system: sys,
    messages: [{ role: "user", content: `Tomorrow's externals:\n${list}\n\n${opts.voice_notes ? `Voice: ${opts.voice_notes}` : ""}\n\nWrite it.` }],
  });

  return extractText(res.content);
}

// Concat any text blocks from a model response, tolerating thinking / tool_use
// blocks the SDK includes in ContentBlock.
function extractText(content: unknown[]): string {
  return content
    .filter((c): c is { type: string; text: string } => typeof c === "object" && c !== null && (c as { type?: string }).type === "text" && typeof (c as { text?: unknown }).text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

// ─── Helpers ────────────────────────────────────────────────────────────
function formatLocalTime(iso: string, tz: string | null): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZone: tz ?? undefined,
      timeZoneName: tz ? "short" : undefined,
    }).format(d);
  } catch { return iso; }
}
function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  catch { return iso; }
}
function truncate(s: string, n: number): string { return s.length <= n ? s : s.slice(0, n - 1) + "…"; }

export const BRIEF_MODEL_NAME = BRIEF_MODEL;
