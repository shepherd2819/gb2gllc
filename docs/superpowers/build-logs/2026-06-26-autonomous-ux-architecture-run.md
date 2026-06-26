# Autonomous Build Run — UI/UX Upgrade + Onboard

- **Started:** 2026-06-26
- **Branch:** `feat/product-ux-upgrade`
- **Driver:** Claude (Opus 4.8, 1M), ultracode / hands-off mode
- **Authorized by:** john@gb2gllc.com — "fully run autonomously … continue building the app's UX and architecture based on industry standard." Track choice: **Both — UI/UX first, then Onboard.** Check-in model: **fully hands-off until done.**
- **Sources of truth:**
  - `docs/superpowers/specs/2026-06-26-gb2g-ui-ux-upgrade-blueprint.md`
  - `docs/superpowers/specs/2026-06-26-enterprise-onboarding-design.md`
  - `docs/superpowers/research/2026-06-26-reference-product-ux-playbook.md`

## Scope of "done"

Engineering-buildable scope only: **UI/UX Phases 0→4**, then **Onboard Phase A**. Onboard B/C are gated on operator actions I cannot perform (SOC 2 vendor + observation window, WorkOS dashboard SSO/SCIM/Org enablement, Stripe webhook event config, Calendly webhook, cron registration, secrets). Those land as a hand-off checklist (task #12), not faked code.

## Safety gates (enforced every phase, since the user is hands-off)

1. All work on `feat/product-ux-upgrade`; never `main`.
2. `npm run typecheck` (`tsc --noEmit`) + `npm run build` must be green before a phase is committed.
3. `npm test` (`node --import tsx --test 'lib/**/*.test.ts'`) green — gates Onboard's pure logic (TDD per repo convention).
4. Every build agent reads `node_modules/next/dist/docs/` before writing framework code (AGENTS.md: "this is NOT the Next.js you know").
5. Per-phase commit with a summary; adversarial review workflow before each commit.

## Ground-truth facts (verified in source, not assumed)

- **Next.js 16.2.6 / React 19.2.4**, custom server. Docs at `node_modules/next/dist/docs/01-app`.
- **Next 16 deltas confirmed:** `error.tsx` signature is `{ error, unstable_retry }` (not `reset`); component-level boundaries use `unstable_catchError` from `next/error`; React 19 `<link rel="stylesheet">` supported; `<head>` link order matters.
- CSS is **plain static files linked from `/public`** (`/portal/portal.css`, `/admin/admin.css`) — no Tailwind, no CSS modules. New `/public/tokens.css` is linked first.
- Components are **colocated client components**; no shared `components/` dir existed. New shared design system lives in `components/ui/`. Alias `@/*` → repo root.
- Tests: `node --import tsx --test 'lib/**/*.test.ts'` — only `lib/**` is unit-tested. UI is verified by typecheck + build (+ Playwright later). So **Onboard's pure logic goes in `lib/` with tests; UI does not get unit tests by this runner.**
- Two divergent token systems confirmed: portal `--parchment/--ink/--warm-gold/--sage/--red` (light only); admin `--bg/--text/--gold/--sage/--red/--blue` (+ `[data-theme="dark"]`). Same role, different hexes.
- Best existing primitive: `.agents-rail` (admin.css ~L751) — sticky left rail, sage `.is-active::before` bar, status dots. Phase 2 generalizes it.
- Pre-existing latent bugs noted (out of Phase 0 scope): portal.css references undefined `--rule-soft` (L452) and `--dusty-blue-deep` (L461).

## Design decision — non-breaking semantic layer

Rather than refactor 1,500 lines of existing CSS (risky in hands-off mode), Phase 0 is **additive**:
- `tokens.css` defines universal scales (`--sp-*`, `--el-*`, `--r-sm/-md/-lg/-pill`, `--ease`, `--dur-*`, `--z-*`), keyframes, skeleton primitives, and `ds-*`-namespaced component classes that consume **semantic** color tokens (`--color-bg`, `--color-gold`, …).
- Each surface stylesheet maps the semantic tokens to its own palette (`portal.css`: `--color-gold: var(--warm-gold)`; `admin.css`: `--color-gold: var(--gold)`), so the one component set themes correctly on both surfaces **and in admin dark mode**, with **zero existing classes touched**.
- Full portal↔admin hex reconciliation (blueprint P2-3) is deferred to Phase 4, as the blueprint itself sequences it.

## Log

- **2026-06-26** — Read all three specs + mapped app. Created branch, task board (#1–12), this log. Read Next 16 css / error-handling / server-client docs. Begin P0a: `tokens.css` + semantic mappings + link wiring.
- **2026-06-26** — Phase 0 foundation authored: `public/tokens.css` (scales, keyframes, skeleton, `ds-*` components, focus rings, reduced-motion), semantic color mappings in portal.css + admin.css, tokens link + `ToastProvider` in both layouts, and `components/ui/` (18 files: Button, LinkButton, Card, Badge/StatusPill, Skeleton family, Spinner, EmptyState, Field, Input, Textarea, Select, Modal, Drawer, toast provider, useDialog, status map, cn). React 19 ref-as-prop (no forwardRef).
- **Verification (Phase 0):** `npm run typecheck` → clean. `npm test` → 180/180 logic tests pass; the lone `lib/devagent/run.test.ts` failure is a parallel test-runner IPC flake (passes 3/3 in isolation) — pre-existing, env-related, not from this work. `npm run build` → `✓ Compiled successfully` + TypeScript pass; full route table emits when env present. (Bare build fails at page-data collection on `supabaseUrl is required` — missing secrets in sandbox, pre-existing, unrelated; verified by re-running with placeholder env → clean build.)
- **Self-caught fix:** raised `--z-*` scale above legacy values (legacy `.modal-overlay`=100, tooltip=60) so `ds-*` overlays layer correctly during migration.
- **Note:** portal layout received an external edit (clients.status suspension gate + `/onboarding` nav link — toward Onboard Phase A); preserved, not reverted; my `ToastProvider` wiring intact inside it.
- **In flight:** adversarial 3-lens review workflow (`phase0-ds-review`) over the DS files before commit.
</content>
</invoke>
