# Analytics "Command Center" — Design Spec (WOW increment)

**Date:** 2026-07-08
**Status:** Approved design, pending implementation plan
**Builds on:** the shipped analytics dashboard (`docs/superpowers/specs/2026-07-07-analytics-dashboard-design.md`).
**Owner direction:** make it "WAY crazier / more advanced." Primary lens chosen: **client-impressing WOW**. Dark theme: **approved**.

## 1. What this increment is (and isn't)

The current dashboard is a clean, static report (KPI hero, trend line, mix/donut, top tables, insight cards, chat, exports). This increment transforms it into a **dark, motion-rich executive "command center"** that makes a client go *"holy cow, I need this"* in a demo — leading with **executive UX** and an **AI narrative briefing**.

**In scope (this increment):** dark executive theme; Overview→Explore→Deep-dive information architecture; hero north-star + pace-to-goal ring; sparkline KPI tiles; AI Executive Briefing; area+brush trend; ranked lists; click-to-drill-through slide-over panels; full-screen Presentation/TV mode; motion (count-up, chart draw-in, hover, live pulse); keyboard nav.

**Deliberately deferred to later increments** (owner agreed): the *analytical-power* pillar (global date-range picker, comparison filters, metric explorer) and the *predictive* pillar (forecasting with confidence bands, anomaly detection, attribution). Hooks are left where they slot in.

**Reuses:** `analytics_metrics` warehouse, `analytics_snapshots`, `computeSnapshot`, the in-house SVG chart kit, the Anthropic layer, the chat. No new tenant surface, no migration to the security model (one small additive migration for a goal + briefing field — see §8).

## 2. The dark command-center theme

A dark theme **scoped to the analytics dashboard container** (`.cc-root`) — the rest of the portal stays light/parchment; the admin mirror is dark too. Achieved by remapping the semantic `--color-*` tokens inside `.cc-root` (near-black bg, elevated raised surfaces, gold/sage/blue/red accents brightened for dark contrast, subtle radial gradient + a faint grid texture, glowing 1px accent hairlines). New `public/analytics/command-center.css` (loaded by the analytics page + mirror), built on `tokens.css` — additive, never edits the existing portal/admin css.

Contrast: all text/marks meet WCAG AA on the dark bg (accents get dark-mode variants). `prefers-reduced-motion` disables all animation. `prefers-color-scheme` is NOT used — the command center is intentionally always-dark (it's a deliberate executive surface, like the presentation mode of premium SaaS).

## 3. Information architecture: Overview → Explore → Deep-dive

The `AnalyticsDashboard` is restructured into three zones (still one shared component, `surface: "portal" | "admin"`, pure props from the snapshot):

1. **Overview (hero band)** — the north-star + AI briefing + secondary KPIs. What an exec sees in 3 seconds.
2. **Explore (main grid)** — the area+brush trend, mix, and ranked lists. Where you scan.
3. **Deep-dive (on demand)** — the slide-over panel that opens when you click an entity.

## 4. Components

### 4.1 Hero north-star (`CcHero`)
- One dominant metric (default: revenue this month), giant animated count-up, its **12-month sparkline** underlaid, a large MoM delta chip **and** a YoY delta chip, and a **pace-to-goal ring** (radial gauge: month-to-date vs the month's target, with projected end-of-month based on run-rate). Uses `donutSegments`/a new `ringArc` geometry.
- The "north-star" metric is configurable later; v2 hardcodes revenue with orders as the ring's secondary.

### 4.2 Sparkline KPI tiles (`CcKpiTile`)
- 3–4 tiles (orders, AOV, active customers, + one more). Each: label, animated value, a delta chip, and its own **inline sparkline**. Hover lifts the tile + reveals a faint tooltip with the exact prev-period value. Reuses `Sparkline` (extended).

### 4.3 AI Executive Briefing (`CcBriefing`)
- A prominent card rendering a 4–6 sentence narrative written by Claude each sync (§7). Header "AI Briefing · <date>", a **Regenerate** button (calls a route that re-runs the generator), and **"Ask a follow-up →"** which opens the chat panel pre-seeded with the briefing as context. Empty/error state: a graceful "Briefing will appear after your next sync."

### 4.4 Area+brush trend (`CcTrend`)
- The 13-month trend as a **dual-series area chart** (revenue area + orders line on a secondary axis), draw-in animation, gradient fill, hover crosshair with a value readout, and a compact **range brush** beneath to focus a sub-window (client-side; re-scales the visible area — does NOT refetch). Built on extended chart geometry.

### 4.5 Ranked lists (`CcRankedList`)
- Top companies / products / agents as sleek rows: rank, name, value, an **inline horizontal bar** (share of top), and a **mini sparkline** of that entity's trajectory. Each row is **clickable → opens the deep-dive panel**. Replaces the plain `DataTable` on this surface.

### 4.6 Drill-through deep-dive (`CcDeepDive`, client)
- A right-side slide-over panel (reuses `Drawer` from components/ui). On open for an entity (company/product/agent + name), it fetches that entity's series from `GET /api/portal/analytics/entity?dim=company&name=Acme` (new route → `store.queryMetrics` filtered by dimension, scoped by `getPortalClientId`), and renders: the entity's own trend, its share of total, its stats, and a "chat about this" link. Fail-soft empty state (relevant because Spiro dimensioned data isn't synced yet — the panel shows "No breakdown data yet for this source").

### 4.7 Presentation / TV mode (`CcPresent`, client)
- A full-screen route `/(portal)/analytics/present` (+ admin mirror) that renders the hero + briefing + trend at large scale and **auto-cycles** through highlights (north-star → top movers → briefing → top companies) on a timer, with big type and slow transitions. Esc exits, arrow keys navigate, spacebar pauses. For showing a client live or a lobby screen. Gated identically to the dashboard (active source required).

## 5. Extended chart kit

Add to `lib/analytics/charts.ts` (pure geometry, unit-tested) + `components/charts/`:
- `ringArc(fraction, radius, thickness)` → gauge/ring path (for pace-to-goal).
- `areaPath(points)` → closed area path (fill under a line).
- Enhance `Sparkline` with an optional fill + last-point dot.
- `CcTrend`'s brush is a component concern (selection math is pure + tested: `brushWindow(range, totalCount)`).
- All colors from `--color-*` tokens (now the dark command-center palette inside `.cc-root`). No hex.

## 6. Motion & interaction

- **Count-up**: reuse/extend the existing `CounterAnimation` (rAF), applied to hero + tiles + briefing numbers. Respects `prefers-reduced-motion`.
- **Draw-in**: charts animate their path via CSS `stroke-dasharray`/`@keyframes` (no JS), disabled under reduced-motion.
- **Live pulse**: a small "· live" dot near "Data as of <sync>" with a gentle CSS pulse.
- **Hover**: tile lift (translateY + shadow), crosshair on the trend, row highlight on ranked lists.
- **Keyboard**: the deep-dive and presentation mode are fully keyboard-operable (focus trap in the drawer, Esc/arrows in present mode).

## 7. AI Executive Briefing generator

`lib/analytics/briefing.ts` (mirrors `insights.ts` structure):
- `BRIEFING_MODEL = "claude-sonnet-4-6"`, `buildBriefingInput(payload)` (pure — turns the snapshot into a compact fact sheet), `generateBriefing(payload): Promise<string>` (Anthropic call; a 4–6 sentence exec narrative citing real numbers; `""` on any failure — never throws).
- Runs in the **post-sync per-client snapshot step** (`analytics-sync.ts`) right after `generateInsights`, stored in `analytics_snapshots.briefing` (new column). Also invokable on demand via `POST /api/portal/analytics/briefing/regenerate` (withAuth-scoped) which recomputes from the current snapshot and persists.
- The chat "ask a follow-up" seeds the chat with the briefing text as an opening assistant message (client-side, not persisted as a real turn).

## 8. Data & migration

Migration **033_analytics_command_center.sql**:
- `ALTER TABLE analytics_snapshots ADD COLUMN briefing TEXT;` (the AI narrative).
- `ALTER TABLE analytics_snapshots ADD COLUMN goal_json JSONB NOT NULL DEFAULT '{}'::jsonb;` — optional per-client monthly targets (e.g. `{ "revenue": 150000 }`); pace-to-goal reads this. Admin sets it via the AnalyticsManager (a small "Monthly revenue goal" field). If unset, pace-to-goal falls back to **same-month-last-year** (or trailing-3-month avg if no YoY data) so the ring is always meaningful.
- No new tables, no RLS change (existing `analytics_snapshots` policy covers the new columns). Next free migration number verified at build time.

`computeSnapshot` gains: `yoy` deltas (same-month-last-year, needs the 24-month backfill), `paceToGoal` (mtd vs target + projected finish), and per-tile sparkline series — all pure, unit-tested. `SnapshotPayload` extends additively (existing consumers unaffected).

## 9. Files

**New:** `public/analytics/command-center.css`; `components/analytics/command-center/{CcHero,CcKpiTile,CcBriefing,CcTrend,CcRankedList,CcDeepDive,CcPresent}.tsx`; `lib/analytics/briefing.ts` (+ test); `app/(portal)/analytics/present/page.tsx` + admin mirror; `app/api/portal/analytics/entity/route.ts`; `app/api/portal/analytics/briefing/regenerate/route.ts`; migration 033.
**Extended:** `lib/analytics/charts.ts` (+ ringArc/areaPath/brushWindow + tests); `components/charts/Sparkline.tsx`; `components/analytics/AnalyticsDashboard.tsx` (restructured into the 3 zones, `.cc-root` wrapper); `lib/analytics/snapshot.ts` (yoy/paceToGoal/sparklines); `lib/inngest/functions/analytics-sync.ts` (call generateBriefing); admin `AnalyticsManager.tsx` (monthly goal field).

## 10. Security, performance, resilience

- No new tenant surface: the two new portal routes derive `clientId` from `getPortalClientId(user.id)` (never the query/body), scope every warehouse read by it. The entity route validates `dim`/`name` and caps rows.
- The dashboard still reads the single snapshot row (one query) — the briefing + new fields ride in the snapshot payload; the entity drill-through is the only on-demand query (lazy, on panel open).
- All heavy AI work (briefing) runs in the sync job or a dedicated route, never a page render. Fail-soft everywhere (missing briefing/goal/dimension data → graceful empty states).
- Motion respects `prefers-reduced-motion`; the dark theme meets AA contrast.

## 11. Testing

`node --test` via tsx: chart geometry (ringArc arcs, areaPath closure, brushWindow selection), snapshot additions (yoy null-edges, paceToGoal projection incl. no-goal fallback, per-tile sparkline series), briefing input builder + parse/fallback (no network in tests). UI components are typecheck-verified + a real `npm run build`; presentation mode + drill-through verified via a dev run.

## 12. Out of scope (future increments)

Analytical-power pillar (date-range/comparison/filters/metric-explorer) and predictive pillar (forecasting/anomaly/attribution) — hooks left in the IA. Real-time streaming. Configurable north-star metric. Multi-source blended views.

## 13. Decisions log

| Question | Decision |
|---|---|
| Primary lens for "crazier" | Client-impressing WOW (executive UX + AI briefing) |
| Theme | Dedicated **dark** command-center, scoped to `.cc-root` (portal stays light elsewhere) |
| Scope this increment | UX transformation + AI briefing; analytical-power & predictive pillars deferred |
| Pace-to-goal source | Admin-set monthly goal; fallback to same-month-last-year / trailing-3-mo avg |
| Drill-through data | Live `queryMetrics` on panel open (graceful empty until dimensioned sync lands) |
| Briefing | New post-sync narrative generator, stored in snapshot, regenerable on demand |
