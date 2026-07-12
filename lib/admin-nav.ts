// lib/admin-nav.ts
// Pure nav model for the admin shell sidebar. No I/O — agent groups are
// injected so this stays trivially testable and the manifest stays the
// single source of truth in app/(admin)/agents/agents-manifest.ts.

export type NavItem = {
  href: string;
  label: string;
  glyph: string;
  badgeKey?: "tickets";
  agentSlug?: string;
  title?: string; // hover tooltip (agent description)
};

export type NavGroup = { label: string | null; items: NavItem[] };
export type NavSection = { key: string; heading: string | null; groups: NavGroup[] };

export type AgentGroupInput = {
  label: string;
  agents: { slug: string; name: string; glyph: string; description: string }[];
};

export function buildNav(agentGroups: AgentGroupInput[]): NavSection[] {
  return [
    {
      key: "home",
      heading: null,
      groups: [{ label: null, items: [{ href: "/admin", label: "Home", glyph: "⌂" }] }],
    },
    {
      key: "work",
      heading: "Work",
      groups: [
        {
          label: null,
          items: [
            { href: "/clients", label: "Clients", glyph: "◫" },
            { href: "/submissions", label: "Submissions", glyph: "▤" },
            { href: "/support", label: "Support", glyph: "◍", badgeKey: "tickets" },
          ],
        },
      ],
    },
    {
      key: "agents",
      heading: "Agents",
      groups: [
        { label: null, items: [{ href: "/agents", label: "All agents", glyph: "✦" }] },
        ...agentGroups.map((g) => ({
          label: g.label,
          items: g.agents.map((a) => ({
            href: `/agents/${a.slug}`,
            label: a.name,
            glyph: a.glyph,
            agentSlug: a.slug,
            title: a.description,
          })),
        })),
      ],
    },
    {
      key: "money",
      heading: "Money",
      groups: [
        {
          label: null,
          items: [
            { href: "/billing", label: "Billing", glyph: "$" },
            { href: "/journeys", label: "Journeys", glyph: "◇" },
          ],
        },
      ],
    },
  ];
}

// /admin and /agents are index pages with children that have their own nav
// items, so they match exactly; every other item owns its whole subtree.
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/admin" || href === "/agents") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}
