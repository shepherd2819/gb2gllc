# Analytics "Live Wire" Redesign — Port Spec

**Goal:** Restyle the deployed Command Center dashboard into the approved **"Live Wire"** neon broadcast-ops aesthetic (owner picked it from a 5-way showcase). Full-throttle: an always-on particle-constellation canvas, electrified charts, neon glow, radar-ping markers, live pulse. Ships straight to production, replacing the current gold/dark theme.

**The approved design is `.superpowers/sdd/live-wire-reference-mockup.html`** — a complete, working, standalone implementation of the exact look, on the real data. The build ports its aesthetic into the token-based React/CSS architecture. When in doubt about a color/glow/motion detail, match that mockup.

**Architecture reality (do not fight):** the dashboard is `.cc-root`-scoped; every component + the SVG chart kit consume `var(--color-*)` tokens defined ONLY in the `.cc-root` remap block of `public/analytics/command-center.css`. So a palette remap re-themes everything automatically. Next.js 16.2.6 nonstandard (server components by default, `"use client"` only for interactive/canvas islands). The command center is intentionally always-dark (single theme — no light mode). No migration, no data change: this is purely visual.

## Global constraints
- **Colors:** literal hex ONLY inside the `.cc-root` token-remap block of `command-center.css` (that IS the palette). Everywhere else — components, chart overrides, new CSS — use `var(--color-*)` / the new glow tokens. No hex in `.tsx`.
- **Motion:** every animation/transition gated so `@media (prefers-reduced-motion: reduce)` inside `.cc-root` disables it and shows the final state. The always-on canvas must render a single static frame (or nothing) under reduced-motion.
- **Performance/cleanup:** the canvas uses one `requestAnimationFrame` loop; cancel any prior loop on re-init (`el.__raf`), stop when the panel is hidden (`offsetParent === null`), clean up on unmount, be DPR-aware, `pointer-events: none`, sit behind content (`z-index`).
- **CSS files:** rewrite `public/analytics/command-center.css` in place; never edit `tokens.css`/`portal.css`/`admin.css`. Chart-kit glow is a SCOPED override inside command-center.css (e.g. `.cc-root .ds-chart-line { filter: ... }`).
- **Commits:** one per task, `feat(analytics): <what>`, ending `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. This is an isolated worktree/branch (`feat/analytics-live-wire`) — `git add` only each task's files.

## THE SHARED CONTRACT — token / class / keyframe vocabulary (all tasks align to this)

### `.cc-root` token remap (Task 1 defines; everything consumes)
Neon "Live Wire" palette. Remap the EXISTING semantic tokens so all current components re-theme, and ADD glow tokens:

| Token | Live Wire value | Where it shows |
|---|---|---|
| `--color-bg` | `#060810` (deep space) | page ground |
| `--color-bg-raised` | `#0e1422` (glassy panel) | cards/tiles |
| `--color-bg-sunken` | `#0a0e1a` | insets |
| `--color-border` | `rgba(120,160,220,0.14)` | hairlines |
| `--color-text` | `#eaf1ff` (cool white) | headings/numbers |
| `--color-text-soft` | `#aab6d4` | body |
| `--color-text-mute` | `#6b7699` | captions |
| `--color-gold` | `#22e0ff` (**CYAN — primary neon**) | hero number, ring arc, ranked values, briefing title, revenue line (CHART_COLORS[0]) |
| `--color-gold-dim` | `rgba(34,224,255,0.16)` | area fills, faint accents |
| `--color-blue` | `#ff3d81` (**MAGENTA — secondary neon**) | orders line (CHART_COLORS[2]), secondary marks |
| `--color-blue-dim` | `rgba(255,61,129,0.16)` | |
| `--color-sage` | `#3df5c8` (neon mint — positive delta) | up chips |
| `--color-sage-dim` | `rgba(61,245,200,0.16)` | |
| `--color-red` | `#ff5470` (neon red — negative delta, CHART_COLORS[3]) | down chips (most deltas are negative here) |
| `--color-red-dim` | `rgba(255,84,112,0.16)` | |
| `--color-on-gold` | `#04121a` | text on cyan |
| `--color-gold-text` / `--color-red-text` | `var(--color-gold)` / `var(--color-red)` | keep |
| `--focus-ring-color` | `var(--color-gold)` (cyan) | focus |
| **NEW** `--glow-cyan` | `0 0 18px rgba(34,224,255,0.55)` | neon glow shadow |
| **NEW** `--glow-magenta` | `0 0 18px rgba(255,61,129,0.55)` | |
| **NEW** `--glow-amber` | `0 0 16px rgba(255,194,75,0.5)` | amber highlight (peak marker) |
| **NEW** `--color-amber` | `#ffc24b` | peak highlight, "live" accent |

(CHART_COLORS in charts.ts is `[--color-gold, --color-sage, --color-blue, --color-red]` → cyan/mint/magenta/red — so the revenue line is cyan, orders line magenta. Good, matches the mockup's cyan→magenta trend.)

### New keyframes (Task 1 defines in command-center.css; components reference by class)
- `cc-slam` — entrance: from `opacity:0; translateY(14px); filter:blur(6px)` → settled. (KPI tiles, panels.)
- `cc-rise` — hero number rise/glow-in.
- `cc-draw` — KEEP (stroke draw-in; enhance with a glow).
- `cc-ping` — radar-ping: a ring that scales up + fades (used by trend peak/current markers).
- `cc-scan` — a horizontal light-sweep translateX (chart scan + optional page scanline).
- `cc-pulse` — KEEP/retune for the live dot (neon).

### New entrance-orchestration classes (Task 1 styles; Task 4 applies where missing)
- `.cc-in` — base "animate in" marker; children/self play `cc-slam`. Stagger via `--i` custom prop (`animation-delay: calc(var(--i,0) * 70ms)`).
- Existing `.cc-hero`, `.cc-tile`, `.cc-panel`, `.cc-briefing`, `.cc-trend` get entrance styling keyed off a root `.cc-live` class (Task 1) so no per-component churn is required beyond mounting.

### New classes the components will emit (contract for Task 3/4)
- `.cc-ambient` — the canvas layer (Task 2): `position:absolute; inset:0; z-index:0; pointer-events:none`. Content sits at `z-index:1+`.
- `.cc-trend-glow` — applied to the revenue line for the neon drop-shadow (Task 1 styles, Task 3 emits).
- `.cc-ping` / `.cc-ping--peak` / `.cc-ping--now` — radar markers in the trend (Task 3 emits, Task 1 styles).
- `.cc-scanline` — optional page-level moving scan sweep (Task 1 defines; Task 4 may mount).

## Files
- **Rewrite:** `public/analytics/command-center.css` (Task 1 — the core).
- **New:** `components/analytics/command-center/CcAmbient.tsx` (Task 2 — always-on canvas).
- **Edit:** `components/analytics/command-center/CcTrend.tsx` (Task 3 — cyan→magenta gradient stroke + glow + radar-ping peak/now markers + scan-sweep on draw-in).
- **Edit:** `components/analytics/AnalyticsDashboard.tsx` (Task 4 — mount `<CcAmbient/>` first inside `.cc-root`, add `.cc-live` root class + entrance orchestration) + the two present pages (`app/(portal)/analytics/present/page.tsx`, `app/(admin)/clients/[id]/analytics/present/page.tsx`) mount `<CcAmbient/>` inside their `.cc-root` div.
- **Verify (Task 5):** tsc + tests + `npm run build`; a throwaway dev preview route to screenshot the real dashboard with real data via Playwright, deleted before the final commit.

## Out of scope
Data/snapshot/route changes; the ranked-breakdown tables (still fail-soft "syncing"); light mode; migration.
