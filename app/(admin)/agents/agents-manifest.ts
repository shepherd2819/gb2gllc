// Single source of truth for the admin agents rail.
// Keep ordered by group → ordered by importance within group.

export type AgentManifestEntry = {
  slug: string;
  name: string;
  tagline: string;
  glyph: string;       // a single-char glyph used in the rail (kept emoji-light by design)
  group: "comms" | "money" | "growth" | "client";
};

export const AGENTS: AgentManifestEntry[] = [
  // ── Comms ──────────────────────────────────────────────────────────
  { slug: "iris",  name: "Iris",  tagline: "Inbox triage",       glyph: "✉", group: "comms" },
  { slug: "wren",  name: "Wren",  tagline: "Support triage",     glyph: "◐", group: "comms" },
  { slug: "holt",  name: "Holt",  tagline: "Meeting prep",       glyph: "◷", group: "comms" },

  // ── Money ──────────────────────────────────────────────────────────
  { slug: "nora",  name: "Nora",  tagline: "Finance · AR",       glyph: "$", group: "money" },
  { slug: "vera",  name: "Vera",  tagline: "Contracts",          glyph: "§", group: "money" },

  // ── Growth ─────────────────────────────────────────────────────────
  { slug: "avery", name: "Avery", tagline: "Outbound outreach",  glyph: "→", group: "growth" },
  { slug: "june",  name: "June",  tagline: "Homepage audits",    glyph: "◎", group: "growth" },

  // ── Client agents ──────────────────────────────────────────────────
  { slug: "mark",  name: "Mark",  tagline: "Real estate · sqft", glyph: "▢", group: "client" },
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
