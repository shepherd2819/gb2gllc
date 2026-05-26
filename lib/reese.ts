import { anthropic } from "@/lib/anthropic";
import { supabaseAdmin } from "@/lib/supabase";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 800;

// ── Pillar -> short label for prompting + UI ────────────────────────────
const PILLAR_LABELS: Record<string, string> = {
  "ai-strategy": "AI strategy for small businesses (practical how-to, ROI angles, concrete saves)",
  "building-in-public": "Behind-the-scenes building GB2G (what we shipped, what we learned, design decisions, founder lens)",
  "tips": "Helpful tips with AI and its capabilities (specific use-cases, lesser-known features, prompt patterns, gotchas)",
  "faith-anchored": "Faith-anchored work (Col. 3:23 framing applied to building software — genuine, not preachy)",
  "industry-news": "Commentary on AI / agents news (react to launches; have a clear POV)",
};

export type ReeseConfig = {
  client_company: string | null;
  content_pillars: string[];
  voice_notes: string | null;
  ctas: string[];
  hashtags: string[];
  banned_words: string[];
};

export async function getReeseConfig(clientId: string): Promise<ReeseConfig | null> {
  const [{ data: client }, { data: cfg }] = await Promise.all([
    supabaseAdmin.from("clients").select("company, name").eq("id", clientId).single(),
    supabaseAdmin.from("client_linkedin_configs").select("*").eq("client_id", clientId).maybeSingle(),
  ]);
  if (!cfg) return null;
  return {
    client_company: client?.company ?? client?.name ?? null,
    content_pillars: cfg.content_pillars ?? [],
    voice_notes: cfg.voice_notes ?? null,
    ctas: cfg.ctas ?? [],
    hashtags: cfg.hashtags ?? [],
    banned_words: cfg.banned_words ?? [],
  };
}

function buildSystemPrompt(config: ReeseConfig, pillar: string): string {
  const pillarLabel = PILLAR_LABELS[pillar] ?? pillar;
  const pillarsList = config.content_pillars.map((p) => `- ${PILLAR_LABELS[p] ?? p}`).join("\n");
  const company = config.client_company ?? "the business";

  return `You are Reese, a LinkedIn ghostwriter who writes for ${company}.

Your job: draft a single LinkedIn post that earns the scroll-stop. Tight openings, plain English, real point of view. The post sounds like a thoughtful operator wrote it — never a marketing team.

Today's pillar: ${pillarLabel}

All pillars this account covers:
${pillarsList || "- (none configured)"}

${config.voice_notes ? `Voice notes from the team:\n${config.voice_notes}\n` : ""}
${config.ctas.length > 0 ? `Available CTAs (rotate, pick the one that fits the post):\n${config.ctas.map(c => `- ${c}`).join("\n")}\n` : ""}
${config.banned_words.length > 0 ? `NEVER use these words: ${config.banned_words.join(", ")}\n` : ""}

Hard rules:
- 1200 characters maximum. Aim for 700-1000 for the sweet spot.
- Open with a single-sentence hook. No "Today I want to talk about...".
- Use line breaks generously — LinkedIn favors short paragraphs.
- One clear point per post. Don't try to say everything.
- Numbers, specifics, concrete examples beat abstractions every time.
- No emoji unless one genuinely punctuates the message.
- No hashtag dump — at most 2-3 directly relevant tags at the end (or none at all if the post is strong without them).
- No "What do you think?" cop-out endings. End with a real CTA from the list above, or with a sharp closing line that resonates.
- Never use these jargon words: "leverage", "synergy", "unlock", "robust", "best-in-class", "game-changer", "delve", "tapestry", "in today's fast-paced world".
${config.hashtags.length > 0 ? `- Preferred hashtags (use 0-3 if any): ${config.hashtags.map(h => h.startsWith("#") ? h : "#" + h).join(", ")}\n` : ""}

Respond with ONLY the post text — no preamble, no markdown, no quote marks.`;
}

// ── Light topic seed: prevents Reese from re-pitching the same angle ──
async function recentPostsContext(clientId: string): Promise<string> {
  const { data: recent } = await supabaseAdmin
    .from("linkedin_posts")
    .select("draft_text, pillar, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(8);
  if (!recent || recent.length === 0) return "(no recent posts yet)";
  return recent
    .map((r, i) => `[${i + 1}] (${r.pillar ?? "—"}) ${r.draft_text.slice(0, 240).replace(/\s+/g, " ")}…`)
    .join("\n");
}

export type DraftResult =
  | { ok: true; text: string; pillar: string; tokens: number; model: string }
  | { ok: false; error: string };

export async function draftLinkedinPost(opts: {
  clientId: string;
  pillar?: string;        // if not provided, picks one from config
}): Promise<DraftResult> {
  const config = await getReeseConfig(opts.clientId);
  if (!config) return { ok: false, error: "No LinkedIn config for this client. Set one up first." };
  if (config.content_pillars.length === 0) {
    return { ok: false, error: "Configure at least one content pillar before drafting." };
  }

  const pillar = opts.pillar && config.content_pillars.includes(opts.pillar)
    ? opts.pillar
    : pickPillar(config.content_pillars);

  const system = buildSystemPrompt(config, pillar);
  const recent = await recentPostsContext(opts.clientId);

  const userMessage = `Draft ONE LinkedIn post for today on this pillar: "${PILLAR_LABELS[pillar] ?? pillar}".

Avoid repeating angles or examples from these recent posts:
${recent}

Write the post now.`;

  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: userMessage }],
    });
    const text = (res.content[0]?.type === "text" ? res.content[0].text : "").trim();
    if (!text) return { ok: false, error: "Empty response from drafter" };
    return {
      ok: true,
      text,
      pillar,
      tokens: (res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0),
      model: MODEL,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function pickPillar(pillars: string[]): string {
  return pillars[Math.floor(Math.random() * pillars.length)];
}
