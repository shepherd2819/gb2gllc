# Admin Portal Shell (Redesign Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin top-nav + hard-reload navigation with a persistent global sidebar (live agent statuses, badges, collapse), a ⌘K command palette, view-transition-animated client-side routing, and a unified theme (analytics respects the admin light/dark toggle; present mode stays dark).

**Architecture:** `app/(admin)/layout.tsx` stays the single `<html>` owner and auth gate, and becomes the shell: `<AdminSidebar>` (client component, nav model from `lib/admin-nav.ts`) + `<main>` content wrapped in a pathname-keyed React `<ViewTransition>` + a globally mounted `<CommandPalette>` (ranking logic in `lib/palette-search.ts`). Agent status fetching moves from `app/(admin)/agents/layout.tsx` into `lib/agent-status.ts` so the root layout can use it; the agents inner rail is then removed (the global sidebar subsumes it). All new styling goes into `public/admin/admin.css` as `shell-*`/`palette-*` classes built on the existing token scales.

**Tech Stack:** Next.js 16.2.6 (modified build — verify APIs against `node_modules/next/dist/docs/`), React 19.2.4 `<ViewTransition>`, Supabase (`supabaseAdmin`), hand-written CSS on `public/tokens.css` scales, `node --test` + tsx for lib tests.

**Spec:** `docs/superpowers/specs/2026-07-10-admin-portal-redesign-design.md`

## Global Constraints

- **No new dependencies.** `package.json` dependencies must not change.
- **Modified Next.js:** before using any Next/React API, verify it in `node_modules/next/dist/docs/` (per AGENTS.md). Key docs: `01-app/02-guides/view-transitions.md`, `01-app/03-api-reference/02-components/link.md`.
- **No inline `style={{}}`** in any file this plan creates or rewrites. All styling via CSS classes on token scales (`--sp-*`, `--r-*`, `--dur*`, `--ease*`, semantic colors).
- **Fail-soft data fetches:** any Supabase query feeding the shell (statuses, badges, palette clients) must be wrapped so a thrown error yields an empty/default value, never a crashed layout.
- **All internal navigation uses `next/link` `<Link>`** — never `<a>` for internal routes. Exception: `/auth/signout` stays a plain `<a>` (real top-level navigation through the auth flow).
- **Motion:** every animation wrapped in `prefers-reduced-motion: reduce` guards; durations/easings from existing tokens.
- **Auth:** the `(admin)/layout.tsx` `withAuth` + `ADMIN_EMAIL` guard is preserved exactly.
- **API routes and database are untouched** in this phase.
- `npm run typecheck` must pass at the end of every task.
- **Pre-existing repo noise:** `lib/herald.test.ts` currently fails to resolve `./herald` (another branch's WIP). Run targeted test files, not bare `npm test`, until the final task; there, report that failure as pre-existing if it persists.

## Execution Setup (before Task 1)

- [ ] Create an isolated worktree/branch via the superpowers:using-git-worktrees skill: branch `feat/admin-shell` **off `main`** (the repo's current checkout is on `feat/hollis-elevated-order-desk`, which belongs to a concurrent session — do not build on it). The spec + this plan live on that other branch; that's fine, this plan file is self-contained.
- [ ] `npm install` in the worktree if `node_modules` is absent, then `npm run typecheck` to confirm a clean baseline.

## File Structure

| File | Responsibility |
|---|---|
| `lib/admin-nav.ts` (new) | Pure nav model: sections/groups/items, active-state derivation. No I/O. |
| `lib/admin-nav.test.ts` (new) | Node tests for the nav model. |
| `lib/palette-search.ts` (new) | Pure palette logic: entry building + query ranking. No I/O. |
| `lib/palette-search.test.ts` (new) | Node tests for palette logic. |
| `lib/agent-status.ts` (new) | `AgentStatus` type + `fetchAgentStatuses()` (moved verbatim from `app/(admin)/agents/layout.tsx`). |
| `app/(admin)/AdminSidebar.tsx` (new) | Client component: global rail UI, collapse, mobile drawer, status dots/badges. |
| `app/(admin)/CommandPalette.tsx` (new) | Client component: ⌘K modal, keyboard handling, navigation. |
| `app/(admin)/ShellTransition.tsx` (new) | Client component: pathname-keyed `<ViewTransition>` wrapper. |
| `app/(admin)/layout.tsx` (rewrite) | Auth gate + shell composition + fail-soft shell data fetches. |
| `app/(admin)/agents/layout.tsx` (modify, then delete) | Loses the status code (Task 3), then deleted entirely (Task 8). |
| `app/(admin)/agents/AgentsSidebar.tsx` (delete in Task 8) | Superseded by `AdminSidebar`. |
| `public/admin/admin.css` (modify) | Softened light tokens; new `shell-*`, `palette-*`, view-transition CSS; dead-class removal at the end. |
| `public/admin/theme-init.js` (modify) | Adds rail-collapse FOUC guard alongside the theme guard. |
| `next.config.ts` (modify) | `experimental.viewTransition: true`. |
| `public/analytics/command-center.css` (modify) | Dark remap scoped to `[data-theme="dark"] .cc-root, .cc-root--dark`. |
| `components/analytics/AnalyticsDashboard.tsx` (modify) | Optional `forceDark` prop. |
| Analytics pages ×3 (modify) | Portal analytics + both present pages force dark; admin mirror follows the toggle. |
| `app/(admin)/{admin,clients,agents,submissions,support,billing}/loading.tsx` (new ×6) | Skeleton fallbacks so client-side transitions land instantly. |

---

### Task 1: Nav model (`lib/admin-nav.ts`)

**Files:**
- Create: `lib/admin-nav.ts`
- Test: `lib/admin-nav.test.ts`

**Interfaces:**
- Consumes: nothing (pure; agent groups are injected as a parameter).
- Produces:
  - `type NavItem = { href: string; label: string; glyph: string; badgeKey?: "tickets"; agentSlug?: string; title?: string }`
  - `type NavGroup = { label: string | null; items: NavItem[] }`
  - `type NavSection = { key: string; heading: string | null; groups: NavGroup[] }`
  - `type AgentGroupInput = { label: string; agents: { slug: string; name: string; glyph: string; description: string }[] }`
  - `buildNav(agentGroups: AgentGroupInput[]): NavSection[]`
  - `isNavActive(pathname: string, href: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// lib/admin-nav.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNav, isNavActive } from "./admin-nav";

const FIXTURE_GROUPS = [
  { label: "Comms", agents: [{ slug: "iris", name: "Iris", glyph: "✉", description: "Inbox triage agent." }] },
  { label: "Money", agents: [{ slug: "nora", name: "Nora", glyph: "$", description: "Finance agent." }] },
];

test("buildNav returns home, work, agents, money sections in order", () => {
  const sections = buildNav(FIXTURE_GROUPS);
  assert.deepEqual(sections.map((s) => s.key), ["home", "work", "agents", "money"]);
});

test("work section contains clients, submissions, support — support carries the tickets badge", () => {
  const work = buildNav(FIXTURE_GROUPS).find((s) => s.key === "work")!;
  const hrefs = work.groups.flatMap((g) => g.items.map((i) => i.href));
  assert.deepEqual(hrefs, ["/clients", "/submissions", "/support"]);
  const support = work.groups[0].items.find((i) => i.href === "/support")!;
  assert.equal(support.badgeKey, "tickets");
});

test("agents section starts with All agents, then one subgroup per manifest group with slug + tooltip carried through", () => {
  const agents = buildNav(FIXTURE_GROUPS).find((s) => s.key === "agents")!;
  assert.equal(agents.groups[0].items[0].href, "/agents");
  assert.equal(agents.groups[1].label, "Comms");
  const iris = agents.groups[1].items[0];
  assert.equal(iris.href, "/agents/iris");
  assert.equal(iris.agentSlug, "iris");
  assert.equal(iris.glyph, "✉");
  assert.equal(iris.title, "Inbox triage agent.");
});

test("money section rescues /journeys into the nav", () => {
  const money = buildNav(FIXTURE_GROUPS).find((s) => s.key === "money")!;
  const hrefs = money.groups.flatMap((g) => g.items.map((i) => i.href));
  assert.deepEqual(hrefs, ["/billing", "/journeys"]);
});

test("isNavActive: /admin and /agents are exact-match; everything else is prefix-match", () => {
  assert.equal(isNavActive("/admin", "/admin"), true);
  assert.equal(isNavActive("/admin/anything", "/admin"), false);
  assert.equal(isNavActive("/agents", "/agents"), true);
  assert.equal(isNavActive("/agents/iris/abc", "/agents"), false);
  assert.equal(isNavActive("/agents/iris/abc", "/agents/iris"), true);
  assert.equal(isNavActive("/clients", "/clients"), true);
  assert.equal(isNavActive("/clients/xyz/logs", "/clients"), true);
  assert.equal(isNavActive("/clientsfoo", "/clients"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test lib/admin-nav.test.ts`
Expected: FAIL — `Cannot find module './admin-nav'`

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test lib/admin-nav.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add lib/admin-nav.ts lib/admin-nav.test.ts
git commit -m "feat(shell): pure nav model for the global admin sidebar"
```

---

### Task 2: Palette search (`lib/palette-search.ts`)

**Files:**
- Create: `lib/palette-search.ts`
- Test: `lib/palette-search.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `type PaletteClient = { id: string; name: string | null; company: string | null; email: string | null }`
  - `type PaletteAgent = { slug: string; name: string; tagline: string; glyph: string }`
  - `type PaletteEntry = { id: string; kind: "page" | "agent" | "client" | "action"; title: string; subtitle?: string; keywords?: string; href: string; glyph: string }`
  - `buildPaletteEntries(clients: PaletteClient[], agents: PaletteAgent[]): PaletteEntry[]`
  - `rankPalette(query: string, entries: PaletteEntry[], limit?: number): PaletteEntry[]`

- [ ] **Step 1: Write the failing test**

```ts
// lib/palette-search.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPaletteEntries, rankPalette } from "./palette-search";

const CLIENTS = [
  { id: "c1", name: "Jane", company: "Acme Roofing", email: "jane@acme.com" },
  { id: "c2", name: null, company: null, email: "solo@nowhere.com" },
];
const AGENTS = [
  { slug: "iris", name: "Iris", tagline: "Inbox triage", glyph: "✉" },
  { slug: "hollis", name: "Hollis", tagline: "AI phone receptionist", glyph: "☎" },
];

test("buildPaletteEntries: client title falls back company → name → email; invoice action targets billing", () => {
  const entries = buildPaletteEntries(CLIENTS, AGENTS);
  const acme = entries.find((e) => e.kind === "client" && e.href === "/clients/c1")!;
  assert.equal(acme.title, "Acme Roofing");
  const solo = entries.find((e) => e.kind === "client" && e.href === "/clients/c2")!;
  assert.equal(solo.title, "solo@nowhere.com");
  const invoice = entries.find((e) => e.kind === "action" && e.href === "/billing?client=c1")!;
  assert.equal(invoice.title, "Invoice Acme Roofing");
});

test("buildPaletteEntries includes the static pages and the agents", () => {
  const entries = buildPaletteEntries([], AGENTS);
  const hrefs = entries.map((e) => e.href);
  for (const h of ["/admin", "/clients", "/submissions", "/support", "/billing", "/journeys", "/agents"]) {
    assert.ok(hrefs.includes(h), `missing page ${h}`);
  }
  assert.ok(entries.some((e) => e.kind === "agent" && e.href === "/agents/iris"));
});

test("rankPalette: empty query returns only pages + agents, capped at limit", () => {
  const entries = buildPaletteEntries(CLIENTS, AGENTS);
  const out = rankPalette("", entries, 8);
  assert.ok(out.length <= 8);
  assert.ok(out.every((e) => e.kind === "page" || e.kind === "agent"));
});

test("rankPalette: title prefix beats substring; unmatched tokens exclude an entry", () => {
  const entries = buildPaletteEntries(CLIENTS, AGENTS);
  const acmeFirst = rankPalette("acme", entries, 8);
  assert.equal(acmeFirst[0].title, "Acme Roofing"); // direct nav ranks above the invoice action
  assert.deepEqual(rankPalette("zzz-no-match", entries, 8), []);
});

test("rankPalette: multi-token 'invoice acme' surfaces the invoice action first", () => {
  const entries = buildPaletteEntries(CLIENTS, AGENTS);
  const out = rankPalette("invoice acme", entries, 8);
  assert.equal(out[0].href, "/billing?client=c1");
});

test("rankPalette: agent lookup by name", () => {
  const entries = buildPaletteEntries(CLIENTS, AGENTS);
  assert.equal(rankPalette("iris", entries, 8)[0].href, "/agents/iris");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test lib/palette-search.test.ts`
Expected: FAIL — `Cannot find module './palette-search'`

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test lib/palette-search.test.ts`
Expected: PASS (6 tests)

> If the "invoice acme" test fails because "Acme Roofing" (client, score 3 for "acme" but 0 for "invoice") — that's correct behavior, it's excluded. If instead the *client entry for Acme* wins on "acme" alone in the prefix test, that's also correct: clients precede actions in entry order and both score 3, so the stable sort keeps the client first.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add lib/palette-search.ts lib/palette-search.test.ts
git commit -m "feat(shell): command palette entry building + ranking logic"
```

---

### Task 3: Extract agent status fetching to `lib/agent-status.ts`

Pure code motion — the root admin layout will need `fetchAgentStatuses()` in Task 7, and the agents layout it currently lives in gets deleted in Task 8.

**Files:**
- Create: `lib/agent-status.ts`
- Modify: `app/(admin)/agents/layout.tsx` (shrink to a thin shell)
- Modify: `app/(admin)/agents/AgentsSidebar.tsx:6-9` (import the type instead of defining it)

**Interfaces:**
- Consumes: `supabaseAdmin` from `@/lib/supabase`; `AGENTS` from the manifest.
- Produces: `export type AgentStatus = { state: "live" | "idle" | "paused" | "unconfigured"; badge?: string | null }` and `export async function fetchAgentStatuses(): Promise<Record<string, AgentStatus>>` — exactly the current signatures.

- [ ] **Step 1: Create `lib/agent-status.ts`**

Copy lines 1–77 of `app/(admin)/agents/layout.tsx` (everything except the default-export layout component) plus the `AgentStatus` type from `AgentsSidebar.tsx:6-9`, adjusting imports:

```ts
// lib/agent-status.ts
// Fail-soft per-agent status for the admin shell rail. Moved out of
// app/(admin)/agents/layout.tsx so the root (admin) layout can badge the
// global sidebar. Every branch fails soft — a missing table or migration
// drift must never break the shell.
import { supabaseAdmin } from "@/lib/supabase";
import { AGENTS } from "@/app/(admin)/agents/agents-manifest";

export type AgentStatus = {
  state: "live" | "idle" | "paused" | "unconfigured"; // live = connected + recent activity; idle = connected but quiet; paused = explicitly paused; unconfigured = nothing connected
  badge?: string | null;                              // e.g. "3" for pending count
};

type Row = { id: string; status?: string | null };

async function rowsOf(p: PromiseLike<{ data: Row[] | null }>): Promise<Row[]> {
  try { return (await p).data ?? []; } catch { return []; }
}
async function countOf(p: PromiseLike<{ count: number | null }>): Promise<number> {
  try { return (await p).count ?? 0; } catch { return 0; }
}

export async function fetchAgentStatuses(): Promise<Record<string, AgentStatus>> {
  const statuses: Record<string, AgentStatus> = {};
  for (const a of AGENTS) statuses[a.slug] = { state: "unconfigured" };

  const [
    iris, wren, holt, nora, vera, avery, june, mark, hollis,
  ] = await Promise.all([
    rowsOf(supabaseAdmin.from("iris_inbox_accounts").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("wren_inbox_accounts").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("holt_accounts").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("nora_accounts").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("contracts").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("avery_campaigns").select("id, status").limit(5)),
    rowsOf(supabaseAdmin.from("june_audits").select("id").limit(5)),
    rowsOf(supabaseAdmin.from("steward_platform_tokens").select("id").eq("platform", "slack").limit(5)),
    rowsOf(supabaseAdmin.from("hollis_lines").select("id, status").neq("status", "released").limit(5)),
  ]);

  const [
    irisPending, wrenPending, noraPendingDrafts, holtUpcoming, averyDrafted, hollisFollowups,
  ] = await Promise.all([
    countOf(supabaseAdmin.from("iris_messages").select("id", { count: "exact", head: true }).eq("status", "classified")),
    countOf(supabaseAdmin.from("wren_messages").select("id", { count: "exact", head: true }).eq("status", "classified")),
    countOf(supabaseAdmin.from("nora_events").select("id", { count: "exact", head: true }).eq("status", "classified").not("draft_body", "is", null)),
    countOf(supabaseAdmin.from("holt_briefings").select("id", { count: "exact", head: true })
      .eq("decision", "briefable")
      .gte("event_start_at", new Date().toISOString())
      .lt("event_start_at", new Date(Date.now() + 24 * 3600_000).toISOString())),
    countOf(supabaseAdmin.from("avery_leads").select("id", { count: "exact", head: true }).eq("status", "drafted")),
    countOf(supabaseAdmin.from("hollis_calls").select("id", { count: "exact", head: true })
      .in("outcome", ["booking_request", "message", "transfer"])
      .gte("created_at", new Date(Date.now() - 7 * 24 * 3600_000).toISOString())),
  ]);

  statuses.iris  = mapStatus(iris,  irisPending);
  statuses.wren  = mapStatus(wren,  wrenPending);
  statuses.holt  = mapStatus(holt,  holtUpcoming);
  statuses.nora  = mapStatus(nora,  noraPendingDrafts);
  statuses.vera  = vera.length > 0 ? { state: "live" } : { state: "unconfigured" };
  statuses.avery = averyDrafted > 0
    ? { state: "live", badge: String(averyDrafted) }
    : avery.length > 0 ? { state: avery.some((c) => c.status === "active") ? "live" : "idle" } : { state: "unconfigured" };
  statuses.june  = june.length > 0 ? { state: "live" } : { state: "idle" };
  statuses.mark  = mark.length > 0 ? { state: "live" } : { state: "unconfigured" };
  statuses.hollis = mapStatus(hollis, hollisFollowups);

  return statuses;
}

function mapStatus(rows: Row[], pending: number): AgentStatus {
  if (rows.length === 0) return { state: "unconfigured" };
  const allPaused = rows.every((r) => r.status === "paused");
  if (allPaused) return { state: "paused" };
  if (pending > 0) return { state: "live", badge: String(pending) };
  return { state: "idle" };
}
```

(Note: the unused `safe()` helper and its `void safe;` line are dropped in the move.)

- [ ] **Step 2: Shrink `app/(admin)/agents/layout.tsx`**

Replace the whole file with:

```tsx
import { fetchAgentStatuses } from "@/lib/agent-status";
import { AgentsSidebar } from "./AgentsSidebar";

export const dynamic = "force-dynamic";

export default async function AgentsLayout({ children }: { children: React.ReactNode }) {
  const statuses = await fetchAgentStatuses();
  return (
    <div className="agents-shell">
      <AgentsSidebar statuses={statuses} />
      <div className="agents-content">{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Point `AgentsSidebar.tsx` at the lib type**

In `app/(admin)/agents/AgentsSidebar.tsx`, replace the local `export type AgentStatus = {...}` block (lines 6–9) with:

```tsx
import type { AgentStatus } from "@/lib/agent-status";
export type { AgentStatus };
```

- [ ] **Step 4: Check for other importers**

Run: `grep -rn "AgentsSidebar\|fetchAgentStatuses\|AgentStatus" app lib components --include="*.ts*" | grep -v node_modules | grep -v agent-status.ts`
Expected: only `app/(admin)/agents/layout.tsx` and `app/(admin)/agents/AgentsSidebar.tsx`. If any other file imports `AgentStatus` from `./AgentsSidebar`, the re-export keeps it compiling — note it for Task 8.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add lib/agent-status.ts "app/(admin)/agents/layout.tsx" "app/(admin)/agents/AgentsSidebar.tsx"
git commit -m "refactor(shell): move agent status fetching to lib/agent-status"
```

---

### Task 4: Shell CSS + rail-collapse FOUC guard

**Files:**
- Modify: `public/admin/admin.css` (token softening at ~line 11; new blocks appended at end of file)
- Modify: `public/admin/theme-init.js`

**Interfaces:**
- Produces (CSS classes consumed by Tasks 5–7): `.shell`, `.shell-rail`, `.shell-rail-top`, `.shell-rail-search`, `.shell-rail-search-text`, `.shell-rail-nav`, `.shell-rail-heading`, `.shell-rail-sublabel`, `.shell-rail-item` (+ `.is-active`), `.shell-rail-glyph`, `.shell-rail-label`, `.shell-dot` (+ `.is-live/.is-idle/.is-paused/.is-unconfigured`), `.shell-badge`, `.shell-rail-foot`, `.shell-rail-collapse`, `.shell-content`, `.shell-content-inner`, `.shell-menu-btn`, `.shell-backdrop`, `.palette-overlay`, `.palette`, `.palette-input`, `.palette-list`, `.palette-item` (+ `.is-active`), `.palette-item-glyph`, `.palette-item-title`, `.palette-item-sub`, `.palette-empty`, view-transition class `shell-section`, and the `[data-rail="collapsed"]` html attribute contract.

- [ ] **Step 1: Soften the light card surface**

In `public/admin/admin.css` line 11, change:

```css
  --bg-2:     #FFFFFF;
```
to
```css
  --bg-2:     #FCFAF5;   /* was pure #FFFFFF — softened for all-day viewing */
```

- [ ] **Step 2: Append the shell CSS block at the end of `admin.css`**

```css
/* ============================================================
   SHELL — global sidebar layout (redesign phase 1)
   ============================================================ */
.shell { display: flex; min-height: 100vh; }

.shell-rail {
  width: 248px; flex-shrink: 0;
  position: sticky; top: 0; height: 100vh;
  display: flex; flex-direction: column;
  background: var(--bg-2); border-right: 1px solid var(--border);
  overflow-y: auto; z-index: var(--z-nav);
  transition: width var(--dur) var(--ease);
  view-transition-name: shell-rail;
}

.shell-rail-top { display: flex; flex-direction: column; gap: 14px; padding: 18px 16px 12px; }
.shell-rail-top .admin-mark { font-size: 17px; }

.shell-rail-search {
  display: flex; align-items: center; gap: 8px;
  font-family: var(--mono); font-size: 11px; color: var(--text-mute);
  background: var(--bg-3); border: 1px solid var(--border); border-radius: var(--r-sm);
  padding: 6px 10px; cursor: pointer;
  transition: border-color var(--dur-fast), color var(--dur-fast);
}
.shell-rail-search:hover { border-color: var(--text-soft); color: var(--text); }
.shell-rail-search .shell-rail-search-text { flex: 1; text-align: left; }
.shell-rail-search kbd { font-family: var(--mono); font-size: 10px; color: var(--text-mute); }

.shell-rail-nav { flex: 1; padding: 4px 10px 16px; display: flex; flex-direction: column; gap: 18px; }
.shell-rail-heading {
  font-family: var(--mono); font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--text-mute); padding: 0 8px; margin-bottom: 6px;
}
.shell-rail-sublabel {
  font-family: var(--mono); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-mute); opacity: 0.75; padding: 8px 8px 2px;
}

.shell-rail-item {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 8px; border-radius: var(--r-sm);
  font-size: 13px; color: var(--text-soft); position: relative;
  transition: background var(--dur-fast), color var(--dur-fast);
}
.shell-rail-item:hover { background: var(--bg-3); color: var(--text); }
.shell-rail-item.is-active { background: var(--sage-dim); color: var(--text); }
.shell-rail-item.is-active::before {
  content: ""; position: absolute; left: -10px; top: 6px; bottom: 6px;
  width: 2px; border-radius: 2px; background: var(--sage);
}
.shell-rail-glyph { font-family: var(--mono); font-size: 13px; width: 18px; text-align: center; flex-shrink: 0; }
.shell-rail-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.shell-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.shell-dot.is-live { background: var(--sage); }
.shell-dot.is-idle { background: var(--text-mute); }
.shell-dot.is-paused { background: var(--gold); }
.shell-dot.is-unconfigured { background: transparent; border: 1px solid var(--border); }
.shell-badge {
  font-family: var(--mono); font-size: 10px; color: var(--gold);
  background: var(--gold-dim); border-radius: var(--r-pill); padding: 1px 7px; flex-shrink: 0;
}

.shell-rail-foot {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px; border-top: 1px solid var(--border);
}
.shell-rail-collapse {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; flex-shrink: 0;
  background: none; border: 1px solid var(--border); border-radius: var(--r-sm);
  cursor: pointer; color: var(--text-mute); font-family: var(--mono); font-size: 12px;
  transition: border-color var(--dur-fast), color var(--dur-fast);
}
.shell-rail-collapse:hover { border-color: var(--text-soft); color: var(--text); }
.shell-rail-foot .admin-signout { margin-left: auto; }

.shell-content { flex: 1; min-width: 0; padding: 36px 32px 80px; }
.shell-content-inner { max-width: 1100px; margin: 0 auto; }

/* Collapsed rail (html[data-rail="collapsed"], persisted in localStorage) */
[data-rail="collapsed"] .shell-rail { width: 64px; }
[data-rail="collapsed"] .shell-rail-label,
[data-rail="collapsed"] .shell-rail-heading,
[data-rail="collapsed"] .shell-rail-sublabel,
[data-rail="collapsed"] .shell-rail-search-text,
[data-rail="collapsed"] .shell-rail-search kbd,
[data-rail="collapsed"] .shell-dot,
[data-rail="collapsed"] .shell-badge,
[data-rail="collapsed"] .shell-rail-top .admin-badge,
[data-rail="collapsed"] .shell-rail-foot .admin-signout,
[data-rail="collapsed"] .shell-rail-foot .theme-toggle-btn { display: none; }
[data-rail="collapsed"] .shell-rail-item { justify-content: center; padding: 8px 0; }
[data-rail="collapsed"] .shell-rail-search { justify-content: center; }
[data-rail="collapsed"] .shell-rail-foot { justify-content: center; }

/* Mobile: rail becomes an overlay drawer (declared after the collapsed rules
   so drawer width wins over icon-rail width below 900px) */
.shell-menu-btn { display: none; }
@media (max-width: 900px) {
  .shell-rail,
  [data-rail="collapsed"] .shell-rail {
    position: fixed; left: 0; top: 0; width: 248px;
    transform: translateX(-100%);
    transition: transform var(--dur) var(--ease);
  }
  .shell-rail.is-open, [data-rail="collapsed"] .shell-rail.is-open { transform: translateX(0); box-shadow: var(--el-3); }
  .shell-menu-btn {
    display: flex; align-items: center; justify-content: center;
    position: fixed; top: 14px; left: 14px; z-index: calc(var(--z-nav) + 1);
    width: 34px; height: 34px;
    background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--r-sm);
    color: var(--text-soft); cursor: pointer; font-size: 15px;
  }
  .shell-backdrop { position: fixed; inset: 0; background: rgba(20, 20, 16, 0.35); z-index: calc(var(--z-nav) - 1); }
  .shell-content { padding-top: 64px; }
}

/* ============================================================
   COMMAND PALETTE (⌘K)
   ============================================================ */
.palette-overlay {
  position: fixed; inset: 0; z-index: var(--z-modal);
  background: rgba(20, 20, 16, 0.45);
  display: flex; justify-content: center; align-items: flex-start;
  padding-top: 14vh;
  animation: ds-overlay-in var(--dur-fast) var(--ease-out);
}
.palette {
  width: min(560px, calc(100vw - 32px));
  background: var(--bg-2); border: 1px solid var(--border);
  border-radius: var(--r-lg); box-shadow: var(--el-3); overflow: hidden;
  animation: ds-modal-in var(--dur) var(--ease);
}
.palette-input {
  width: 100%; border: none; outline: none; background: transparent;
  padding: 16px 18px; font-family: var(--sans); font-size: 15px; color: var(--text);
  border-bottom: 1px solid var(--border);
}
.palette-input::placeholder { color: var(--text-mute); }
.palette-list { max-height: 320px; overflow-y: auto; padding: 6px; }
.palette-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: var(--r-sm); cursor: pointer;
  font-size: 13px; color: var(--text-soft);
}
.palette-item.is-active { background: var(--sage-dim); color: var(--text); }
.palette-item-glyph { font-family: var(--mono); width: 18px; text-align: center; color: var(--text-mute); }
.palette-item-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.palette-item-sub { font-family: var(--mono); font-size: 10px; color: var(--text-mute); }
.palette-empty { padding: 18px; font-family: var(--mono); font-size: 11px; color: var(--text-mute); text-align: center; }

/* ============================================================
   VIEW TRANSITIONS — section navigation (sidebar link clicks)
   Old content fades fast; new content fades in + rises gently.
   The rail is anchored (never animates) so the eye keeps a fixed frame.
   ============================================================ */
@keyframes shell-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes shell-rise { from { transform: translateY(8px); } to { transform: none; } }

::view-transition-old(.shell-section) {
  animation: 120ms var(--ease-out) both shell-fade reverse;
}
::view-transition-new(.shell-section) {
  animation: 210ms var(--ease) 90ms both shell-fade, 300ms var(--ease) both shell-rise;
}

::view-transition-group(shell-rail) { animation: none; }
::view-transition-old(shell-rail) { display: none; }
::view-transition-new(shell-rail) { animation: none; }

@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(*), ::view-transition-new(*), ::view-transition-group(*) {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
  }
  .shell-rail { transition: none; }
}
```

- [ ] **Step 3: Extend the FOUC guard**

Replace the contents of `public/admin/theme-init.js` with:

```js
(function(){var t=localStorage.getItem('gb2g_admin_theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');var r=localStorage.getItem('gb2g_admin_rail');if(r==='collapsed')document.documentElement.setAttribute('data-rail','collapsed');})();
```

- [ ] **Step 4: Commit**

CSS-only change; nothing consumes it yet, so verification is Task 7's dev walkthrough.

```bash
git add public/admin/admin.css public/admin/theme-init.js
git commit -m "feat(shell): shell/palette/view-transition CSS + rail-collapse FOUC guard"
```

---

### Task 5: `AdminSidebar` component

**Files:**
- Create: `app/(admin)/AdminSidebar.tsx`

**Interfaces:**
- Consumes: `buildNav`, `isNavActive` (Task 1); `AgentStatus` (Task 3); `GROUPED_AGENTS` manifest; `AdminThemeToggle`; CSS classes (Task 4).
- Produces: `<AdminSidebar statuses={Record<string, AgentStatus>} ticketCount={number} />` — used by the layout in Task 7. Dispatches `window` event `"gb2g:open-palette"` when the search button is clicked.

- [ ] **Step 1: Write the component**

```tsx
// app/(admin)/AdminSidebar.tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buildNav, isNavActive, type NavItem } from "@/lib/admin-nav";
import type { AgentStatus } from "@/lib/agent-status";
import { GROUPED_AGENTS } from "./agents/agents-manifest";
import { AdminThemeToggle } from "./AdminThemeToggle";

const NAV_SECTIONS = buildNav(GROUPED_AGENTS);

export function AdminSidebar({
  statuses,
  ticketCount,
}: {
  statuses: Record<string, AgentStatus>;
  ticketCount: number;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggleCollapsed() {
    const el = document.documentElement;
    if (el.getAttribute("data-rail") === "collapsed") {
      el.removeAttribute("data-rail");
      localStorage.setItem("gb2g_admin_rail", "open");
    } else {
      el.setAttribute("data-rail", "collapsed");
      localStorage.setItem("gb2g_admin_rail", "collapsed");
    }
  }

  return (
    <>
      <button className="shell-menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open navigation">☰</button>
      {mobileOpen && <div className="shell-backdrop" onClick={() => setMobileOpen(false)} />}

      <aside className={`shell-rail${mobileOpen ? " is-open" : ""}`}>
        <div className="shell-rail-top">
          <Link href="/admin" className="admin-mark" onClick={() => setMobileOpen(false)}>
            gb<span className="a2">2</span>g<span className="admin-badge">admin</span>
          </Link>
          <button
            className="shell-rail-search"
            onClick={() => { setMobileOpen(false); window.dispatchEvent(new Event("gb2g:open-palette")); }}
          >
            <span className="shell-rail-glyph">⌕</span>
            <span className="shell-rail-search-text">Search</span>
            <kbd>⌘K</kbd>
          </button>
        </div>

        <nav className="shell-rail-nav">
          {NAV_SECTIONS.map((section) => (
            <div key={section.key}>
              {section.heading && <div className="shell-rail-heading">{section.heading}</div>}
              {section.groups.map((group, gi) => (
                <div key={gi}>
                  {group.label && <div className="shell-rail-sublabel">{group.label}</div>}
                  {group.items.map((item) => (
                    <RailItem
                      key={item.href}
                      item={item}
                      active={isNavActive(pathname, item.href)}
                      status={item.agentSlug ? statuses[item.agentSlug] : undefined}
                      count={item.badgeKey === "tickets" ? ticketCount : 0}
                      onNavigate={() => setMobileOpen(false)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </nav>

        <div className="shell-rail-foot">
          <button className="shell-rail-collapse" onClick={toggleCollapsed} aria-label="Toggle sidebar width">⟨⟩</button>
          <AdminThemeToggle />
          <a href="/auth/signout" className="admin-signout">Sign out</a>
        </div>
      </aside>
    </>
  );
}

function RailItem({
  item, active, status, count, onNavigate,
}: {
  item: NavItem;
  active: boolean;
  status: AgentStatus | undefined;
  count: number;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={item.href}
      className={`shell-rail-item${active ? " is-active" : ""}`}
      title={item.title ?? item.label}
      transitionTypes={["nav-section"]}
      onClick={onNavigate}
    >
      <span className="shell-rail-glyph">{item.glyph}</span>
      <span className="shell-rail-label">{item.label}</span>
      {count > 0 && <span className="shell-badge">{count}</span>}
      {item.agentSlug && <AgentDot status={status} />}
    </Link>
  );
}

function AgentDot({ status }: { status: AgentStatus | undefined }) {
  if (!status) return <span className="shell-dot is-unconfigured" aria-label="not configured" />;
  if (status.badge && status.badge !== "0") return <span className="shell-badge">{status.badge}</span>;
  return <span className={`shell-dot is-${status.state}`} aria-label={status.state} />;
}
```

- [ ] **Step 2: Verify the `transitionTypes` Link prop against the bundled docs**

Run: `grep -n "transitionTypes" node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md | head -5`
Expected: the prop is documented. If `npm run typecheck` (next step) rejects the prop, re-read that doc section and adjust to the documented API (do not cast to `any` silently — if it's genuinely absent, remove the prop here and tag navigations via `useRouter().push(href, { transitionTypes: ["nav-section"] })` per `use-router.md`).

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck
git add "app/(admin)/AdminSidebar.tsx"
git commit -m "feat(shell): global admin sidebar with statuses, badges, collapse, mobile drawer"
```

---

### Task 6: `CommandPalette` component

**Files:**
- Create: `app/(admin)/CommandPalette.tsx`

**Interfaces:**
- Consumes: `buildPaletteEntries`, `rankPalette`, `PaletteClient` (Task 2); `AGENTS` manifest; palette CSS (Task 4). Opens on `⌘K`/`Ctrl+K` or the `"gb2g:open-palette"` window event.
- Produces: `<CommandPalette clients={PaletteClient[]} />` — mounted once by the layout in Task 7.

- [ ] **Step 1: Write the component**

```tsx
// app/(admin)/CommandPalette.tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildPaletteEntries, rankPalette, type PaletteClient } from "@/lib/palette-search";
import { AGENTS } from "./agents/agents-manifest";

export function CommandPalette({ clients }: { clients: PaletteClient[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(
    () => buildPaletteEntries(clients, AGENTS.map((a) => ({ slug: a.slug, name: a.name, tagline: a.tagline, glyph: a.glyph }))),
    [clients],
  );
  const results = useMemo(() => rankPalette(query, entries), [query, entries]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    function onOpenEvent() { setOpen(true); }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("gb2g:open-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("gb2g:open-palette", onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Focus after the overlay mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" && results[activeIndex]) { e.preventDefault(); go(results[activeIndex].href); }
  }

  if (!open) return null;

  return (
    <div className="palette-overlay" onClick={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Jump to a client, agent, or page…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          aria-label="Search"
        />
        <div className="palette-list">
          {results.length === 0 && <div className="palette-empty">No matches</div>}
          {results.map((r, i) => (
            <div
              key={r.id}
              className={`palette-item${i === activeIndex ? " is-active" : ""}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => go(r.href)}
            >
              <span className="palette-item-glyph">{r.glyph}</span>
              <span className="palette-item-title">{r.title}</span>
              {r.subtitle && <span className="palette-item-sub">{r.subtitle}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npm run typecheck
git add "app/(admin)/CommandPalette.tsx"
git commit -m "feat(shell): ⌘K command palette"
```

---

### Task 7: Rewrite the admin layout as the shell + enable view transitions

This is the flip: top nav out, sidebar/palette/transitions in.

**Files:**
- Create: `app/(admin)/ShellTransition.tsx`
- Modify: `app/(admin)/layout.tsx` (full rewrite below)
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `AdminSidebar` (Task 5), `CommandPalette` (Task 6), `fetchAgentStatuses` (Task 3), CSS (Task 4).
- Produces: the shell contract every later phase builds on — pages render inside `.shell-content-inner`, animated by `ShellTransition`; the sidebar shows statuses/badges on every admin page.

- [ ] **Step 1: Read the view-transitions guide**

Read `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md` (whole file). Key facts to confirm: `experimental.viewTransition: true` config flag; `import { ViewTransition } from 'react'`; `key`-triggered transitions; `enter`/`exit` maps keyed by transition type with `default: 'none'`.

- [ ] **Step 2: Enable the flag in `next.config.ts`**

Add to the config object (top level, alongside `redirects`/`rewrites`):

```ts
  experimental: {
    viewTransition: true,
  },
```

- [ ] **Step 3: Create `app/(admin)/ShellTransition.tsx`**

```tsx
// app/(admin)/ShellTransition.tsx
"use client";
import { ViewTransition } from "react";
import { usePathname } from "next/navigation";

// Keyed on pathname so every route change remounts the boundary, which is
// what activates enter/exit. Only navigations tagged 'nav-section' (sidebar
// links) animate; everything else maps to 'none'.
export function ShellTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition
      key={pathname}
      enter={{ "nav-section": "shell-section", default: "none" }}
      exit={{ "nav-section": "shell-section", default: "none" }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
```

> If `ViewTransition` is not exported from `react` at typecheck time, check the guide again — the modified React build may export it as `unstable_ViewTransition` (`import { unstable_ViewTransition as ViewTransition } from "react"`). Use whichever the bundled docs/types actually provide.

- [ ] **Step 4: Rewrite `app/(admin)/layout.tsx`**

```tsx
import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { ToastProvider } from "@/components/ui/toast";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchAgentStatuses } from "@/lib/agent-status";
import type { PaletteClient } from "@/lib/palette-search";
import { AdminSidebar } from "./AdminSidebar";
import { CommandPalette } from "./CommandPalette";
import { ShellTransition } from "./ShellTransition";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

async function fetchOpenTicketCount(): Promise<number> {
  try {
    const { count } = await supabaseAdmin
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "in_progress", "awaiting_review"]);
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function fetchPaletteClients(): Promise<PaletteClient[]> {
  try {
    const { data } = await supabaseAdmin
      .from("clients")
      .select("id, name, company, email")
      .order("company")
      .limit(500);
    return data ?? [];
  } catch {
    return [];
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin?next=/admin");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const [statuses, ticketCount, clients] = await Promise.all([
    fetchAgentStatuses(),
    fetchOpenTicketCount(),
    fetchPaletteClients(),
  ]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>GB2G · Admin</title>
        <link rel="icon" href="/favicon-512.png" type="image/png" />
        <link rel="apple-touch-icon" href="/favicon-512.png" />
        <meta name="theme-color" content="#F7F5F0" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/tokens.css" />
        <link rel="stylesheet" href="/admin/admin.css" />
        <script src="/admin/theme-init.js" />
      </head>
      <body>
        <div className="shell">
          <AdminSidebar statuses={statuses} ticketCount={ticketCount} />
          <main className="shell-content">
            <div className="shell-content-inner">
              <ToastProvider>
                <ShellTransition>{children}</ShellTransition>
              </ToastProvider>
            </div>
          </main>
        </div>
        <CommandPalette clients={clients} />
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If `ViewTransition` or `transitionTypes` fail here, resolve per the doc-check notes in Task 5 Step 2 / Task 7 Step 3 before proceeding.

- [ ] **Step 6: Dev-server walkthrough**

Run: `npm run dev` (background), then in a browser (or Playwright MCP if the WorkOS dev session allows) open `http://localhost:3000/admin` and verify:
- Sidebar renders with Home / Work / Agents (grouped, with dots) / Money (Journeys present); active item highlights; old top nav gone.
- Clicking Clients → Submissions → an agent navigates **without full page reload** (devtools Network: no document request) and content fades/rises while the rail stays frozen.
- `⌘K` opens the palette; typing a client name and pressing Enter navigates; Escape closes.
- Collapse button shrinks the rail to icons; reload preserves it (no flash).
- Theme toggle still works in both rail states.
- At <900px viewport, the hamburger + drawer works.

Note: `/agents/*` will show the old inner rail **beside** the new global one until Task 8 — expected at this step.

- [ ] **Step 7: Commit**

```bash
git add "app/(admin)/layout.tsx" "app/(admin)/ShellTransition.tsx" next.config.ts
git commit -m "feat(shell): global sidebar layout, ⌘K palette mount, view transitions"
```

---

### Task 8: Remove the agents inner rail

The global sidebar now lists every agent; the nested rail is redundant chrome.

**Files:**
- Delete: `app/(admin)/agents/layout.tsx`
- Delete: `app/(admin)/agents/AgentsSidebar.tsx`

- [ ] **Step 1: Confirm nothing else imports them**

Run: `grep -rn "AgentsSidebar" app lib components | grep -v node_modules`
Expected: only `app/(admin)/agents/layout.tsx`. If another file imports `AgentStatus` from `./AgentsSidebar`, repoint it to `@/lib/agent-status` first.

- [ ] **Step 2: Delete both files**

```bash
git rm "app/(admin)/agents/layout.tsx" "app/(admin)/agents/AgentsSidebar.tsx"
```

- [ ] **Step 3: Typecheck + dev check**

Run: `npm run typecheck` → PASS.
Dev server: `/agents` (fleet grid) and `/agents/iris` render full-width inside the global shell, exactly one sidebar on screen, agent nav items still highlight per `isNavActive`.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(shell): drop the agents inner rail — global sidebar subsumes it"
```

---

### Task 9: Theme-aware analytics (kill the dark island)

**Files:**
- Modify: `public/analytics/command-center.css` (the `.cc-root { ... }` token-remap block, starting ~line 17)
- Modify: `components/analytics/AnalyticsDashboard.tsx:15,22`
- Modify: `app/(portal)/analytics/page.tsx`, `app/(portal)/analytics/present/page.tsx`, `app/(admin)/clients/[id]/analytics/present/page.tsx` (force dark)
- NOT modified: `app/(admin)/clients/[id]/analytics/page.tsx` (the admin mirror now follows the admin toggle — that's the point)

- [ ] **Step 1: Split the `.cc-root` block in `command-center.css`**

The current single `.cc-root { ... }` block mixes dark token values with structural rules. Split it into:

```css
/* Structural — applies in BOTH themes (all values via tokens) */
.cc-root {
  position: relative;
  background-color: var(--color-bg);
  background-image:
    radial-gradient(ellipse 900px 480px at 50% -12%, color-mix(in oklch, var(--color-gold) 12%, transparent), transparent 65%),
    repeating-linear-gradient(0deg, color-mix(in oklch, var(--color-text) 3%, transparent) 0 1px, transparent 1px 64px),
    repeating-linear-gradient(90deg, color-mix(in oklch, var(--color-text) 3%, transparent) 0 1px, transparent 1px 64px);
  color: var(--color-text);
}

/* Dark remap — admin dark mode, or forced (present mode + portal) */
[data-theme="dark"] .cc-root,
.cc-root--dark {
  color-scheme: dark;
  --color-bg: #06080a;
  --color-bg-raised: #12151b;
  --color-bg-sunken: #1a1e25;
  --color-border: #232a33;
  --color-text: #f2ede0;
  --color-text-soft: #b7bcb0;
  --color-text-mute: #82898f;
  --color-gold: #e8c877;
  --color-gold-dim: rgba(232, 200, 119, 0.16);
  --color-sage: #b9d2ab;
  --color-sage-dim: rgba(185, 210, 171, 0.14);
  --color-red: #ef9273;
  --color-red-dim: rgba(239, 146, 115, 0.14);
  --color-blue: #93c1e8;
  --color-blue-dim: rgba(147, 193, 232, 0.14);
  --color-on-gold: #14110a;
  --color-gold-text: var(--color-gold);
  --color-red-text: var(--color-red);
  --focus-ring-color: var(--color-gold);
}
```

Preserve the existing header comment, updating its claim: the file's literal dark hex now lives only in the `[data-theme="dark"] .cc-root, .cc-root--dark` block.

- [ ] **Step 2: Add `forceDark` to `AnalyticsDashboard`**

In `components/analytics/AnalyticsDashboard.tsx`, change the signature (line 15) and root div (line 22):

```tsx
export function AnalyticsDashboard({ snapshot, surface, forceDark }: { snapshot: SnapshotRow; surface: "portal" | "admin"; forceDark?: boolean }) {
```
```tsx
    <div className={`cc-root${forceDark ? " cc-root--dark" : ""} ds-analytics ds-analytics--${surface}`}>
```

- [ ] **Step 3: Update the four call sites**

Run: `grep -rn "AnalyticsDashboard\|className=\"cc-root\"" app | grep -v node_modules` to list them, then:
- `app/(portal)/analytics/page.tsx`: add `forceDark` to the `<AnalyticsDashboard ... />` element (portal chrome is light-only; its dashboard keeps today's dark look).
- `app/(portal)/analytics/present/page.tsx` and `app/(admin)/clients/[id]/analytics/present/page.tsx`: change `<div className="cc-root">` → `<div className="cc-root cc-root--dark">` (if the portal present page renders `<AnalyticsDashboard>`, pass `forceDark` instead).
- `app/(admin)/clients/[id]/analytics/page.tsx`: **no change** — it now follows the admin toggle.

- [ ] **Step 4: Verify both modes**

Dev server, on an admin client's analytics page:
- Admin light mode: dashboard renders light (parchment surfaces, readable charts, no black island). Skim charts/ranked lists for anything illegible; if a `cc-*` rule outside the remap block hardcodes a dark assumption, fix it to a token.
- Toggle dark: dashboard renders exactly as before (near-black executive theme).
- `/clients/[id]/analytics/present`: dark in both admin modes.
- Portal `/analytics` (if reachable in dev): still dark.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add public/analytics/command-center.css components/analytics/AnalyticsDashboard.tsx "app/(portal)/analytics/page.tsx" "app/(portal)/analytics/present/page.tsx" "app/(admin)/clients/[id]/analytics/present/page.tsx"
git commit -m "feat(theme): analytics respects the admin light/dark toggle; present + portal stay dark"
```

---

### Task 10: Route skeletons (`loading.tsx` × 6)

Instant-feeling client-side transitions need loading fallbacks so navigation lands immediately while data streams.

**Files:**
- Create: `app/(admin)/admin/loading.tsx`, `app/(admin)/clients/loading.tsx`, `app/(admin)/agents/loading.tsx`, `app/(admin)/submissions/loading.tsx`, `app/(admin)/support/loading.tsx`, `app/(admin)/billing/loading.tsx`

- [ ] **Step 1: Create the six files** — identical content (uses the `skel-*` classes from `tokens.css`):

```tsx
export default function Loading() {
  return (
    <div className="skel-stack" aria-busy="true" aria-label="Loading">
      <div className="skel skel-text w-40" />
      <div className="skel skel-stat" />
      <div className="skel skel-row" />
      <div className="skel skel-row" />
      <div className="skel skel-row" />
      <div className="skel skel-row" />
    </div>
  );
}
```

- [ ] **Step 2: Verify**

`npm run typecheck` → PASS. Dev server with devtools network throttled to "Fast 4G": clicking between sidebar sections shows the shimmer skeleton instantly, then content streams in (and the Suspense handoff animates once content arrives).

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/loading.tsx" "app/(admin)/clients/loading.tsx" "app/(admin)/agents/loading.tsx" "app/(admin)/submissions/loading.tsx" "app/(admin)/support/loading.tsx" "app/(admin)/billing/loading.tsx"
git commit -m "feat(shell): skeleton loading states for the six main admin routes"
```

---

### Task 11: Dead-CSS cleanup + full verification

**Files:**
- Modify: `public/admin/admin.css` (remove `.admin-nav`, `.admin-nav-links`, and the `agents-shell`/`agents-rail` block)

- [ ] **Step 1: Confirm the classes are dead**

```bash
grep -rn "admin-nav\|agents-rail\|agents-shell\|agents-content" app components lib | grep -v node_modules
```
Expected: no hits (all consumers were rewritten/deleted in Tasks 7–8). If a page still uses `agents-content` or similar, leave that class and remove only the truly dead ones.

- [ ] **Step 2: Remove the dead blocks from `admin.css`**

Delete the `.admin-nav` + `.admin-nav-links` rules (section "── 3. NAV ──", keeping `.admin-mark`, `.a2`, `.admin-badge`, `.admin-signout`, `.theme-toggle-btn` — the sidebar reuses them) and the whole agents-rail/agents-shell block (~lines 783–1038; verify boundaries by reading the section comments before deleting). Also delete `.admin-main` if the grep shows no remaining users.

- [ ] **Step 3: Full verification pass**

```bash
npm run typecheck        # PASS
npm test                 # all lib tests pass; lib/herald.test.ts failure is pre-existing (see Global Constraints) — report it, don't fix it here
```

Dev-server checklist (light AND dark, both rail states):
- Every sidebar destination loads: /admin, /clients, /clients/[id], /submissions, /support, /billing, /journeys, /agents, /agents/iris, /agents/sawyer.
- No unstyled elements from the CSS removal (spot-check /agents pages especially).
- View transitions: sidebar navigation animates; browser back/forward does NOT animate (untyped) but works; with OS reduced-motion enabled, no animation anywhere.
- `⌘K` from a deep page (e.g. /agents/iris) jumps anywhere.
- Screenshot each: /admin light, /admin dark, /clients/[id]/analytics light + dark, /agents collapsed-rail — attach to the PR/summary for John.

- [ ] **Step 4: Commit**

```bash
git add public/admin/admin.css
git commit -m "chore(shell): remove dead top-nav and agents-rail CSS"
```

- [ ] **Step 5: Wrap up the branch**

Use the superpowers:finishing-a-development-branch skill — present John the merge/PR options for `feat/admin-shell`.

---

## Self-Review Notes

- **Spec coverage (Phase 1 scope):** sidebar ✓ (T1/4/5/7), ⌘K ✓ (T2/6), client-side routing + view transitions ✓ (T5/7), anchored shell ✓ (T4), theme unification ✓ (T9), Sawyer status = explicitly deferred to Phase 3 per spec open item (his rail dot shows `unconfigured` until then), Inbox merge = Phase 4 (sidebar ships Submissions + Support separately, swap in Phase 4), status-fetch caching = spec open item, deliberately not done here.
- **Deliberate deviation:** the spec lists the shared page primitives (`PageHeader`, `DataTable`, `KpiTile`, `StatusChip`, `SectionNav`, `ConfirmModal`) under Phase 1, but nothing in the shell consumes them — they get built at the START of Phase 2 (client workspace), with their first real consumer, per YAGNI. The shell-specific primitives this phase does ship are `AdminSidebar`, `CommandPalette`, and `ShellTransition`.
- **Type consistency:** `AgentStatus` single-sourced from `lib/agent-status.ts` after T3; `PaletteClient` shape matches the layout's Supabase select (`id, name, company, email`); `buildNav` input shape matches `GROUPED_AGENTS` structurally (label + agents with slug/name/glyph/description).
- **Known risks flagged inline:** `ViewTransition` export name and `transitionTypes` prop are verified against bundled docs at the exact steps that use them, with documented fallbacks.
