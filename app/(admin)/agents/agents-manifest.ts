// Single source of truth for the admin agents rail.
// Keep ordered by group → ordered by importance within group.

export type AgentManifestEntry = {
  slug: string;
  name: string;
  tagline: string;
  description: string; // 1–3 sentence summary of CURRENT capabilities — rendered as the hover tooltip on the agent cards (/agents) and the left rail.
  glyph: string;       // a single-char glyph used in the rail (kept emoji-light by design)
  group: "comms" | "money" | "growth" | "client";
};

export const AGENTS: AgentManifestEntry[] = [
  // ── Comms ──────────────────────────────────────────────────────────
  { slug: "iris",  name: "Iris",  tagline: "Inbox triage",       glyph: "✉", group: "comms",
    description: "Polls your founder Gmail every 2 minutes, classifies each new message (lead / support / internal / newsletter / calendar / spam / personal / other), drafts a reply in your voice for the actionable ones, and labels the email in Gmail. Never auto-sends — you click to send." },
  { slug: "wren",  name: "Wren",  tagline: "Support triage",     glyph: "◐", group: "comms",
    description: "Sibling to Iris, scoped to support@gb2gllc.com. Classifies into bug / feature_request / account_help / billing_question / general / spam, matches the sender to a known client for warm context, and drafts a reply with the Speak-to-Support CTA. You approve every send." },
  { slug: "holt",  name: "Holt",  tagline: "Meeting prep",       glyph: "◷", group: "comms",
    description: "Reads your Google Calendar (read-only) and runs Sonnet web research on each attendee. Emails you an evening digest of tomorrow's meetings plus a 2-hour-before brief on the day-of." },

  // ── Money ──────────────────────────────────────────────────────────
  { slug: "nora",  name: "Nora",  tagline: "Finance · AR",       glyph: "$", group: "money",
    description: "Watches Stripe via webhook + hourly reconcile poll. Classifies events (failed payment / churn / refund / dispute / payout failure), drafts polite dunning emails for your approval, sends urgent admin alerts, and ships a Monday-morning cash digest with MRR, balance, top customers, and runway." },
  { slug: "vera",  name: "Vera",  tagline: "Contracts",          glyph: "§", group: "money",
    description: "Generates contracts from a Notion master template, emails them out for signature, and pings Slack when one is signed. Tracks contract status in a Notion contracts database." },

  // ── Growth ─────────────────────────────────────────────────────────
  { slug: "avery", name: "Avery", tagline: "Outbound outreach",  glyph: "→", group: "growth",
    description: "Internal cold-outreach tool. Upload a leads CSV or PDF; Avery scrapes each lead's website, drafts a personalized email against your campaign briefing (Sonnet), and queues drafts for your approval. Sends via Resend with a configurable daily cap." },
  { slug: "june",  name: "June",  tagline: "Homepage audits",    glyph: "◎", group: "growth",
    description: "The live chat agent on gb2gllc.com. Talks with visitors, scrapes their site, generates a PDF \"AI Opportunity Audit\" with 3–5 agent ideas tailored to their business, and emails it. Rate-limited to one audit per visitor IP." },

  // ── Client agents ──────────────────────────────────────────────────
  { slug: "mark",  name: "Mark",  tagline: "Real estate · sqft", glyph: "▢", group: "client",
    description: "Slack slash command /sqft <address>. Looks up property data via ATTOM (primary), falls back to RentCast, and replies with sqft, beds, baths, year built, and property type in the channel. Every lookup is logged for audit." },
];

export const GROUP_LABELS: Record<AgentManifestEntry["group"], string> = {
  comms:  "Comms",
  money:  "Money",
  growth: "Growth",
  client: "Client agents",
};

export const GROUPED_AGENTS: { group: AgentManifestEntry["group"]; label: string; agents: AgentManifestEntry[] }[] = (() => {
  const out: { group: AgentManifestEntry["group"]; label: string; agents: AgentManifestEntry[] }[] = [];
  const seen = new Set<string>();
  for (const a of AGENTS) {
    if (seen.has(a.group)) {
      out[out.length - 1].agents.push(a);
    } else {
      seen.add(a.group);
      out.push({ group: a.group, label: GROUP_LABELS[a.group], agents: [a] });
    }
  }
  return out;
})();
