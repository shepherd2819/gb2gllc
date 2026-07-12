# Admin Portal Redesign — Design Spec

**Date:** 2026-07-10
**Status:** Approved by John (option A: new shell first, then rebuild room by room)

## Goals

The admin portal is John's daily all-day workspace. The redesign optimizes for:

1. **Effortless navigation** — anything reachable in one or two clicks, or one ⌘K keystroke.
2. **Clean, not info-rich** — progressive disclosure; calm by default, detail one click down.
3. **Smooth animations** — client-side routing with view transitions; no more full page reloads.
4. **Better organization** — a real information architecture instead of six flat links hiding wildly different depths.
5. **No eye strain** — consistent luminance (no dark island), tuned contrast, disciplined type.

Daily-driver areas (confirmed): **Clients, Agents fleet, Submissions & Support.** Billing and Journeys are secondary.

## Current-state findings (summary)

- Six-item top nav rendered as plain `<a>` tags — every click is a full page reload. `/journeys` exists but is linked from nowhere.
- `/clients/[id]` is the heaviest page: 22 parallel Supabase queries, 13 always-expanded manager cards in one scroll, no product gating, no internal navigation.
- The Agents section has the best pattern in the app: `agents-manifest.ts` (single source of truth) + `AgentsSidebar.tsx` rail with live status dots (`fetchAgentStatuses()`, fail-soft; covers 9 of 10 agents — Sawyer missing).
- A real design system exists (`public/tokens.css`: semantic `--color-*` contract, spacing/radius/motion/z scales, `ds-*` component classes, `components/ui/*` React wrappers) but only ~4 of 64 admin files use it. Most pages hand-write `admin-*` classes or inline `style={{}}`.
- Three theme regimes collide: admin light/dark toggle, light-only portal, always-dark analytics command center (`.cc-root` unconditional token remap) — a light header sits directly above a black dashboard.
- Perf drag on the most-visited pages: the 22-query waterfall, N+1 count loops on Iris/Nora indexes, per-request status fan-out in the agents layout.
- Platform check: Next.js 16.2.6 supports React `<ViewTransition>` behind `experimental.viewTransition: true`, `transitionTypes` on `<Link>`/router, and `unstable_instant` route validation. (Per AGENTS.md, always verify against `node_modules/next/dist/docs/` during implementation.)

## Decisions

| Decision | Choice |
|---|---|
| Execution | **A — new shell first, then rebuild areas in daily-use order** (Clients → Agents → Inbox → Home → Billing/Journeys) |
| Global nav | **Global left sidebar + ⌘K command palette**, client-side routing everywhere |
| Client detail | **Sidebar sub-nav workspace** — deep-linkable section routes, product-gated |
| Theme | **Unified toggle.** Calm parchment light as default; command-center dark generalized to portal-wide dark mode; `/present` routes stay always-dark |
| Scope | **Redesign + perf fixes on touched pages.** API routes and data contracts unchanged |
| Submissions + Support | **Merged into one "Inbox"** triage view with two tabs and a combined badge (reversible if it doesn't feel right) |

## Design language: "calm editorial"

Keep the existing identity — parchment `#F7F5F0`, ink text, sage/gold/rust accents, EB Garamond / Inter / JetBrains Mono — and enforce it through the token system:

- **Single source of styling:** every rebuilt page uses `tokens.css` scales + `ds-*` classes + `components/ui/*` wrappers. No inline `style={{}}` on rebuilt pages; no new bespoke one-off class families.
- **New shared primitives** (added to `components/ui/` and `tokens.css`, replacing today's three dialects): `PageHeader`, `DataTable`, `KpiTile`, `StatusChip`, `SectionNav` (inner rail), `ConfirmModal` (replaces native `confirm()`/`alert()`).
- **Type discipline:** EB Garamond for page titles only; JetBrains Mono for micro-labels and numeric values only (with `font-variant-numeric: tabular-nums`); Inter everywhere else. Table body text bumped for readability (≥13px). Uppercase mono labels keep letter-spacing but drop to a muted tone.
- **Color discipline:** rust/red reserved for genuine errors and destructive actions. Sage = live/ok, gold = attention/pending, mute = idle/off.
- **Agent branding:** the manifest's mono glyphs are the single agent mark. Full-color emoji in `h1`s are removed.

## Theme unification

- Promote the command-center dark palette into the global `[data-theme="dark"]` override set in `tokens.css`/`admin.css` so one toggle themes everything, including embedded analytics dashboards (`.cc-root` maps to semantic tokens instead of hard-coded near-black hex).
- Light mode: soften the highest-contrast pairings (pure-white cards on parchment; near-black text) a step for long-session comfort while keeping AA contrast.
- `/present` analytics routes remain always-dark (client-facing, intentional drama).
- Keep the existing FOUC guard (`theme-init.js`) and `AdminThemeToggle`, relocated into the sidebar footer.

## Global shell

**Sidebar** (evolved from `AgentsSidebar`; the top nav is removed):

```
GB2G            ⌘K search
⌂ Home
WORK
  Clients
  Inbox            (badge: open submissions + tickets)
AGENTS
  Comms    ● Iris (badge) · ● Wren · ● Holt
  Money    ● Nora · ● Vera
  Growth   ● Avery · ● June · ● Sawyer
  Client   ● Mark · ● Hollis
MONEY
  Billing
  Journeys
──────────────
theme toggle · sign out
```

- Collapsible to an icon-only rail; state persisted in `localStorage`. Below 900px it becomes an overlay drawer.
- Live status dots and badges reuse `fetchAgentStatuses()`; **Sawyer gets a status** (based on recent proposal activity). Status fetch stays fail-soft; add short-lived caching so it isn't recomputed on every request.
- Active item derived from pathname (same pattern as today's agents rail).
- All navigation uses `<Link>` (prefetching + client-side transitions). No `<a>` tags for internal routes.

**⌘K command palette:** fuzzy jump to any client (`/clients/[id]` + sections), agent, or page, plus a few verbs ("invoice ‹client›" → prefilled `/billing?client=`). Client list is fetched once and cached; palette is a lightweight custom component on `ds-modal` primitives (no new dependency).

**Layout note:** `(admin)/layout.tsx` keeps owning `<html>` (matches the existing two-route-group architecture) and becomes the shell provider: sidebar + content viewport + `<ViewTransition>` wiring. `experimental.viewTransition: true` is added to `next.config.ts` (affects nothing until components opt in).

## Client workspace (`/clients/[id]`)

Becomes a nested layout with its own slim inner rail (`SectionNav`), one route segment per section:

```
/clients/[id]            → Overview (default)
/clients/[id]/products/[product]   → one per ACTIVE product (hollis, herald, maya, reese, ada, steward)
/clients/[id]/money      → Contract + Invoices (links to /billing?client= preserved)
/clients/[id]/announcements
/clients/[id]/account    → EditClientForm + ClientControls + Atrium onboarding
/clients/[id]/logs       → full logs (existing page absorbed)
/clients/[id]/analytics  → existing command-center mirror (now theme-aware)
```

- **Product gating:** the rail lists only products enabled for the client (from the existing products field `ClientControls` manages). An "Add product" affordance in the rail exposes the rest. Disabled products render nothing and query nothing.
- **Overview:** KPI row (existing 4 stats), one status card per active product (name, status chip, one key number, link to its section), recent-logs preview (last ~8), quick actions (send invoice, open analytics, copy portal invite).
- **Layout fetches once** (client row + products + stat counts); **each section page fetches only its own data** — replacing the 22-query `Promise.all`. Sections get `loading.tsx` skeletons (`skel-*` classes exist).
- **Managers are restyled, not rewired:** each `*Manager.tsx` keeps its `initial*` props and `/api/admin/clients/[id]/…` calls, moves into its section route, and swaps inline styles for `ds-*`. The copy-pasted `flash()`/busy-state idiom is extracted to a shared `useFlash()` hook + `ds-toast`.

## Agents section

- Keep: manifest, rail, grouped fleet overview, status model.
- Unify page interiors on **three templates**: **list + detail** (Hollis, Holt, Nora, Avery, Vera), **two-pane inbox** (Iris, Wren — the existing pattern, restyled and decluttered: actions grouped, reasoning box collapsed by default), **console** (Sawyer — restyled onto tokens, gets a `PageHeader` and a back link).
- One `PageHeader` with manifest glyph + name + tagline; one `DataTable`; one KPI treatment (`KpiTile`).
- Native `confirm()`/`alert()` replaced by `ConfirmModal`/toasts.
- Perf: Iris/Nora N+1 count loops become single aggregate queries.
- Auth: remove per-page `withAuth` + hardcoded-email re-checks; the `(admin)` layout guard is the single gate.

## Inbox (Submissions + Support merged)

- New `/inbox` route with two tabs — **Submissions** and **Tickets** — preserving the existing tables/detail routes (`/submissions/[id]`, `/support/[id]` keep their URLs; old list URLs redirect to `/inbox`).
- Combined open count badges the sidebar item; tab switches use same-route crossfade.
- Row treatment unified on `DataTable`; open/closed filter is a segmented control instead of `?all=1` links.

## Home (`/admin`)

One-column "morning briefing" replacing the two dense log tables:

- **Needs attention** feed, priority-ordered: new submissions, open tickets, pending Reese drafts, unread Iris/Wren items, recent error logs. Each row: source glyph, one line, timestamp, link. Empty state: "All clear."
- Quiet KPI row above (existing 4 stats, restyled).
- Quick actions row (invite client, send invoice, ⌘K hint).
- Data comes from existing tables already queried elsewhere (submissions, tickets, drafts, inbox counts, error logs) — no new APIs.

## Motion system

Built on the existing motion tokens (`--ease`, `--dur-fast/--dur/--dur-slow`) and React `<ViewTransition>`:

- **Directional slides** on drill-in/back (list → detail tagged `nav-forward`, back links `nav-back`), per the bundled Next.js view-transitions guide.
- **Same-route crossfades** for tab/section switches (Inbox tabs, client workspace sections) via keyed `<ViewTransition>`.
- **Suspense reveals:** skeleton slides down / content slides up on streamed data.
- **Anchored shell:** sidebar and page header carry `viewTransitionName`s with animation suppressed — the frame never moves; only content does.
- Micro-interactions: existing hover lifts/focus rings; sidebar collapse animates width; badges pulse once on increment.
- Everything wrapped in `prefers-reduced-motion: reduce` (already conventional in this codebase).
- Key daily routes export `unstable_instant` where feasible to validate instant navigation at build time.

## Error handling

- Fail-soft stays the rule: status fetch failures render mute dots, never break the shell.
- Section-level `error.tsx` boundaries in the client workspace so one broken manager doesn't take down the page.
- Destructive actions (disconnect, delete, suspend) always go through `ConfirmModal`.
- Mutation feedback via the shared toast; errors persist until dismissed, successes auto-clear.

## Testing & verification

- `npm run typecheck` clean at every phase; existing `npm test` (node test runner) untouched.
- Playwright (MCP) visual verification per phase: light + dark screenshots of shell, client workspace, one agent per template, Inbox, Home; verify view transitions don't break with JS-disabled fallback (links still work as normal navigations).
- Manual checks: theme toggle covers analytics; reduced-motion honored; 900px collapse behavior.

## Phasing (each phase ships usable)

1. **Shell** — sidebar, ⌘K, view-transition wiring, theme unification, new shared primitives.
2. **Clients** — workspace rail, section routes, product gating, per-section queries, manager restyles.
3. **Agents** — three templates, Sawyer normalization + status, N+1 fixes, modal/toast swap.
4. **Inbox** — merged triage view, redirects, badges.
5. **Home** — morning briefing.
6. **Billing + Journeys** — restyle onto primitives; journeys joins the nav (already in shell phase); cleanup pass deleting dead `admin-*` CSS.

## Out of scope

- Portal (client-facing) redesign; portal stays light-only for now.
- API route or database changes; MCP/REST sync; new dependencies (no Tailwind/shadcn migration).
- Deep manager-logic refactors beyond presentation + the named perf fixes.
- Mobile-first optimization (portal is desktop-first; 900px collapse is the floor).

## Open items to validate during implementation

- Exact `viewTransition` + `unstable_instant` behavior against `node_modules/next/dist/docs/` (this Next.js is a modified build — verify APIs before use, per AGENTS.md).
- Whether Supabase queries for badges/status need the short-lived cache immediately or can ship uncached at current data volumes.
- Sawyer status heuristic (proposal activity window) — pick during agents phase.
