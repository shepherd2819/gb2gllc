// lib/palette-search.ts
// Pure logic for the ⌘K command palette: entry construction + ranking.
// Substring/prefix scoring, no fuzzy-subsequence — predictable beats clever
// for a list this small (pages + agents + a few hundred clients).

export type PaletteClient = { id: string; name: string | null; company: string | null; email: string | null };
export type PaletteAgent = { slug: string; name: string; tagline: string; glyph: string };

export type PaletteEntry = {
  id: string;
  kind: "page" | "agent" | "client" | "action";
  title: string;
  subtitle?: string;
  keywords?: string;
  href: string;
  glyph: string;
};

const PAGES: PaletteEntry[] = [
  { id: "page-home", kind: "page", title: "Home", href: "/admin", glyph: "⌂", keywords: "overview dashboard" },
  { id: "page-clients", kind: "page", title: "Clients", href: "/clients", glyph: "◫" },
  { id: "page-submissions", kind: "page", title: "Submissions", href: "/submissions", glyph: "▤", keywords: "intake leads" },
  { id: "page-support", kind: "page", title: "Support", href: "/support", glyph: "◍", keywords: "tickets" },
  { id: "page-billing", kind: "page", title: "Billing", href: "/billing", glyph: "$", keywords: "invoices" },
  { id: "page-journeys", kind: "page", title: "Journeys", href: "/journeys", glyph: "◇", keywords: "onboarding" },
  { id: "page-agents", kind: "page", title: "All agents", href: "/agents", glyph: "✦", keywords: "fleet" },
];

export function buildPaletteEntries(clients: PaletteClient[], agents: PaletteAgent[]): PaletteEntry[] {
  const agentEntries: PaletteEntry[] = agents.map((a) => ({
    id: `agent-${a.slug}`,
    kind: "agent",
    title: a.name,
    subtitle: a.tagline,
    keywords: a.slug,
    href: `/agents/${a.slug}`,
    glyph: a.glyph,
  }));

  const clientEntries: PaletteEntry[] = clients.map((c) => ({
    id: `client-${c.id}`,
    kind: "client",
    title: c.company || c.name || c.email || "Client",
    subtitle: c.email ?? undefined,
    href: `/clients/${c.id}`,
    glyph: "◫",
  }));

  const actionEntries: PaletteEntry[] = clients.map((c) => ({
    id: `action-invoice-${c.id}`,
    kind: "action",
    title: `Invoice ${c.company || c.name || c.email || "client"}`,
    keywords: "invoice billing send",
    href: `/billing?client=${c.id}`,
    glyph: "$",
  }));

  return [...PAGES, ...agentEntries, ...clientEntries, ...actionEntries];
}

function tokenScore(token: string, e: PaletteEntry): number {
  const t = e.title.toLowerCase();
  if (t === token) return 5;
  if (t.startsWith(token)) return 4;
  if (t.split(/\s+/).some((w) => w.startsWith(token))) return 3;
  if (t.includes(token)) return 2;
  const hay = `${e.subtitle ?? ""} ${e.keywords ?? ""}`.toLowerCase();
  if (hay.includes(token)) return 1;
  return 0;
}

export function rankPalette(query: string, entries: PaletteEntry[], limit = 8): PaletteEntry[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return entries.filter((e) => e.kind === "page" || e.kind === "agent").slice(0, limit);
  }

  const scored: { entry: PaletteEntry; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    let score = 0;
    for (const token of tokens) {
      const s = tokenScore(token, entry);
      if (s === 0) return; // every token must match somewhere
      score += s;
    }
    scored.push({ entry, score, index });
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.entry);
}
