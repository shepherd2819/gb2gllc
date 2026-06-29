# GB2G Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared design-system foundation — unified tokens, a component library, the cockpit shell, and the loading/feedback system — that the portal (Plan 2) and later admin cycles consume.

**Architecture:** Custom global CSS (no Tailwind) lives in `public/*.css` and is `<link>`ed in each route-group root layout; React components in `components/ui/*` and `components/shell/*` emit classNames that those stylesheets define. Pure, testable logic (status→tone map, ⌘K filter) lives in `lib/ui/*` and is unit-tested with `node:test`. A dev-only `/ui` gallery route renders every primitive in all states for visual + a11y verification.

**Tech Stack:** Next.js 16.2.6 (App Router, **modified build — always defer to `node_modules/next/dist/docs/`**), React 19, TypeScript (strict), `node --test` via `tsx`.

## Global Constraints

- **Next.js is a modified 16.2.6** — before using any Next API (`loading`/`error`/`Suspense`/client boundaries), confirm against `node_modules/next/dist/docs/`. `error.tsx` uses the `unstable_retry` prop (v16.2), not `reset`.
- **No Tailwind, no CSS-in-JS, no CSS Modules.** Styling = global classes in `public/*.css`, consumed by className. New shared styles go in `public/tokens.css` (variables only) and `public/ui.css` (component + shell classes). Both are `<link>`ed after the font links and **before** the surface stylesheet.
- **Path alias:** `@/*` → `./*` (e.g. `@/components/ui/Button`, `@/lib/ui/status`).
- **Client components** start with `"use client";`. Data-fetching stays in server components. Interactive primitives are client components.
- **Test runner:** `npm test` = `node --import tsx --test 'lib/**/*.test.ts'`. Only files under `lib/**` are auto-discovered. Tests use `node:test` + `node:assert/strict`.
- **Typecheck gate:** `npm run typecheck` (`tsc --noEmit`) must pass after every task.
- **Fonts** (EB Garamond, Inter, JetBrains Mono) are already loaded in the route-group layouts — do not re-add.
- **Buttons are ink-forward:** primary = solid ink, gold is the accent + the `:focus-visible` ring (`box-shadow: 0 0 0 3px var(--gold-dim)`).
- **All motion** wrapped in `@media (prefers-reduced-motion: reduce)`.
- **Commit after every task** with a `feat:`/`test:`/`chore:` message; we are on branch `feat/foundation-portal`.
- **Brand tokens** are the single source of color/space/type — never hardcode hex in components or `ui.css`; reference `var(--…)`.

---

### Task 1: Design tokens + shared stylesheet scaffold

**Files:**
- Create: `public/tokens.css`
- Create: `public/ui.css`
- Modify: `app/(portal)/layout.tsx` (add two `<link>`s in `<head>`)
- Modify: `app/(admin)/layout.tsx` (add two `<link>`s in `<head>`)

**Interfaces:**
- Produces: the full CSS custom-property set on `:root` and `[data-theme="dark"]`; `public/ui.css` (empty section markers, base reset). Every later task references these tokens and appends classes to `ui.css`.

- [ ] **Step 1: Create `public/tokens.css`**

```css
/* ============================================================
   GB2G UNIFIED DESIGN TOKENS — tokens.css
   Single source of color / type / space / radius / elevation /
   motion / z-index for BOTH portal and admin. Variables only.
   ============================================================ */
:root {
  /* ── Surfaces ── */
  --bg:#F4EEE2; --bg-raised:#FAF6EC; --bg-sunken:#EDE6D6; --bg-ink:#1C1E1B;
  --border:#E4DDCC; --border-soft:#EEE7D8;
  /* ── Text ── */
  --text:#1C1E1B; --text-soft:#4A4D47; --text-mute:#8A8C85; --text-on-ink:#FAF6EC;
  /* ── Accents (fill · accessible text · dim background) ── */
  --gold:#C9A961; --gold-deep:#9B7E3F; --gold-text:#8A6B28; --gold-dim:rgba(201,169,97,.14);
  --sage:#A6B49B; --sage-text:#3D5E38; --sage-dim:rgba(166,180,155,.16);
  --red:#B4552E;  --red-text:#943220;  --red-dim:rgba(180,85,46,.10);
  --blue:#7F9DB9; --blue-text:#2E5480; --blue-dim:rgba(127,157,185,.12);
  /* ── Type ── */
  --font-serif:"EB Garamond",Georgia,serif;
  --font-sans:"Inter",ui-sans-serif,system-ui,sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,monospace;
  --fw-light:300; --fw:400; --fw-med:500; --fw-semi:600;
  --text-9:9px; --text-10:10px; --text-11:11px; --text-12:12px; --text-13:13px;
  --text-14:14px; --text-16:16px; --text-18:18px; --text-22:22px; --text-26:26px;
  --text-32:32px; --text-40:40px; --text-52:52px; --text-64:64px;
  /* ── Space (4px base) ── */
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:20px; --sp-6:24px;
  --sp-8:32px; --sp-10:40px; --sp-12:48px; --sp-16:64px; --sp-20:80px;
  /* ── Radius ── */
  --r-sm:6px; --r:10px; --r-lg:14px; --r-pill:100px;
  /* ── Elevation ── */
  --el-0:none;
  --el-1:0 1px 2px rgba(28,30,27,.05);
  --el-2:0 8px 24px -12px rgba(28,30,27,.18);
  --el-3:0 18px 44px -18px rgba(28,30,27,.30);
  /* ── Motion ── */
  --ease:cubic-bezier(.16,1,.3,1); --ease-out:cubic-bezier(.22,1,.36,1);
  --dur-fast:120ms; --dur:160ms; --dur-slow:1s;
  /* ── Z-index ── */
  --z-rail:30; --z-topbar:40; --z-drawer:50; --z-modal:55; --z-toast:60; --z-tooltip:70; --z-cmdk:80;
}
[data-theme="dark"] {
  --bg:#0F1110; --bg-raised:#171A18; --bg-sunken:#0B0C0B; --bg-ink:#EDE7D7;
  --border:#2A2E2A; --border-soft:#21241F;
  --text:#EDE7D7; --text-soft:#B8B5A8; --text-mute:#8A8C85; --text-on-ink:#1C1E1B;
  --gold:#D8BC7A; --gold-deep:#C9A961; --gold-text:#D8BC7A;
  --sage:#A6B49B; --sage-text:#A6B49B;
  --red:#D08A6A; --red-text:#D08A6A;
  --blue:#9DB8D2; --blue-text:#9DB8D2;
}
```

- [ ] **Step 2: Create `public/ui.css` with the base scaffold**

```css
/* ============================================================
   GB2G SHARED UI — ui.css
   Component + shell classes built on tokens.css. Append per task.
   Load order in layouts: fonts → tokens.css → ui.css → surface css
   ============================================================ */

/* === BASE === */
*, *::before, *::after { box-sizing: border-box; }
:where(button, input, select, textarea) { font: inherit; color: inherit; }

/* Sections appended by later tasks:
   [Buttons] [Fields] [Card] [Badge] [Skeleton] [EmptyState]
   [Toast] [Modal/Drawer] [Tabs] [Breadcrumbs] [Avatar] [Tooltip]
   [CommandPalette] [Shell] */
```

- [ ] **Step 3: Link both stylesheets in the portal layout**

In `app/(portal)/layout.tsx`, inside `<head>`, immediately AFTER the existing Google Fonts `<link …rel="stylesheet" />` and BEFORE `<link rel="stylesheet" href="/portal/portal.css" />`, add:

```tsx
        <link rel="stylesheet" href="/tokens.css" />
        <link rel="stylesheet" href="/ui.css" />
```

- [ ] **Step 4: Link both stylesheets in the admin layout**

In `app/(admin)/layout.tsx`, inside `<head>`, immediately AFTER the Google Fonts `<link …rel="stylesheet" />` and BEFORE `<link rel="stylesheet" href="/admin/admin.css" />`, add the same two lines:

```tsx
        <link rel="stylesheet" href="/tokens.css" />
        <link rel="stylesheet" href="/ui.css" />
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add public/tokens.css public/ui.css "app/(portal)/layout.tsx" "app/(admin)/layout.tsx"
git commit -m "feat: unified design tokens + shared ui.css scaffold"
```

---

### Task 2: Bespoke icon set

**Files:**
- Create: `components/ui/icons.tsx`

**Interfaces:**
- Produces: `export type IconName` (string union) and `export function Icon({ name, className, size }: { name: IconName; className?: string; size?: number })`. All later components consume `Icon`/`IconName`.

- [ ] **Step 1: Create `components/ui/icons.tsx`**

```tsx
import * as React from "react";

// Bespoke GB2G line icons. 24px grid, stroke via currentColor.
const PATHS = {
  dashboard: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></>,
  link: <><path d="M10.5 13.5l3-3"/><path d="M8.5 11.5l-1.8 1.8a3.2 3.2 0 1 0 4.5 4.5l1.8-1.8"/><path d="M15.5 12.5l1.8-1.8a3.2 3.2 0 1 0-4.5-4.5l-1.8 1.8"/></>,
  support: <><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.4"/><path d="M6 6l3.6 3.6M18 6l-3.6 3.6M6 18l3.6-3.6M18 18l-3.6-3.6"/></>,
  user: <><circle cx="12" cy="8" r="3.6"/><path d="M5.5 19.2a6.6 6.6 0 0 1 13 0"/></>,
  activity: <path d="M3 12h4l2.4-6.2 4.2 13L16.8 12H21"/>,
  chat: <path d="M4 6.6A2.6 2.6 0 0 1 6.6 4h10.8A2.6 2.6 0 0 1 20 6.6v6A2.6 2.6 0 0 1 17.4 15.2H10l-4.6 3.4v-3.4H6.6A2.6 2.6 0 0 1 4 12.6z"/>,
  briefcase: <><rect x="3.5" y="7.5" width="17" height="11" rx="2.2"/><path d="M8.6 7.5V6.2A2.2 2.2 0 0 1 10.8 4h2.4a2.2 2.2 0 0 1 2.2 2.2v1.3"/><path d="M3.5 12.6h17"/></>,
  building: <><path d="M3.6 20.4h16.8"/><path d="M5.6 20.4V8l6.4-3.8L18.4 8v12.4"/><path d="M9.6 20.4v-5h4.8v5"/></>,
  settings: <><path d="M4 8h9.5M17.5 8H20M4 16h2.5M11 16H20"/><circle cx="15.5" cy="8" r="2.3"/><circle cx="8.5" cy="16" r="2.3"/></>,
  search: <><circle cx="11" cy="11" r="6.4"/><path d="M19.8 19.8l-4-4"/></>,
  bell: <><path d="M6.5 10a5.5 5.5 0 1 1 11 0c0 4 1.5 5.2 1.5 5.2H5s1.5-1.2 1.5-5.2z"/><path d="M10.2 18.6a2 2 0 0 0 3.6 0"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  arrow: <path d="M5 12h13M13 6l6 6-6 6"/>,
  trash: <path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.4L18 7"/>,
  check: <path d="M5 12.5l4.2 4.2L19 7"/>,
  close: <path d="M6 6l12 12M18 6L6 18"/>,
  undo: <><path d="M9 7L4.5 11.5 9 16"/><path d="M4.5 11.5H14a5 5 0 0 1 5 5v1"/></>,
  inbox: <><path d="M3.5 13h4l1.5 3h6l1.5-3h4"/><path d="M5 13L7 5.5A1.5 1.5 0 0 1 8.4 4.5h7.2A1.5 1.5 0 0 1 17 5.5L19 13v4.5A1.5 1.5 0 0 1 17.5 19h-11A1.5 1.5 0 0 1 5 17.5z"/></>,
  sparkle: <path d="M12 4l1.8 4.7L18.5 10l-4.7 1.3L12 16l-1.8-4.7L5.5 10l4.7-1.3z"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className, size = 16 }: { name: IconName; className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add components/ui/icons.tsx
git commit -m "feat: bespoke GB2G icon set"
```

---

### Task 3: Status → tone map (TDD)

**Files:**
- Create: `lib/ui/status.ts`
- Test: `lib/ui/status.test.ts`

**Interfaces:**
- Produces: `export type Tone = "sage"|"gold"|"red"|"blue"|"mute";` `export type StatusKind = "ticket"|"lead"|"contract"|"event"|"product";` `export function statusTone(kind: StatusKind, status: string): Tone;` `export function statusLabel(status: string): string;`

- [ ] **Step 1: Write the failing test**

Create `lib/ui/status.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { statusTone, statusLabel } from "./status";

test("ticket statuses map to tones", () => {
  assert.equal(statusTone("ticket", "open"), "gold");
  assert.equal(statusTone("ticket", "in_progress"), "blue");
  assert.equal(statusTone("ticket", "resolved"), "sage");
});

test("contract + lead + event + product tones", () => {
  assert.equal(statusTone("contract", "signed"), "sage");
  assert.equal(statusTone("contract", "voided"), "mute");
  assert.equal(statusTone("lead", "approved"), "sage");
  assert.equal(statusTone("lead", "failed"), "red");
  assert.equal(statusTone("event", "dismissed"), "mute");
  assert.equal(statusTone("product", "active"), "sage");
  assert.equal(statusTone("product", "building"), "gold");
});

test("unknown status falls back to mute", () => {
  assert.equal(statusTone("ticket", "banana"), "mute");
});

test("statusLabel humanizes snake_case", () => {
  assert.equal(statusLabel("in_progress"), "In progress");
  assert.equal(statusLabel("open"), "Open");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './status'`.

- [ ] **Step 3: Write the implementation**

Create `lib/ui/status.ts`:

```ts
export type Tone = "sage" | "gold" | "red" | "blue" | "mute";
export type StatusKind = "ticket" | "lead" | "contract" | "event" | "product";

// status value → tone, per kind. Values verified against supabase/migrations/*.
const MAP: Record<StatusKind, Record<string, Tone>> = {
  ticket:   { open: "gold", in_progress: "blue", awaiting_review: "gold", resolved: "sage" },
  lead:     { pending: "blue", researched: "blue", drafted: "blue", approved: "sage", sent: "sage", rejected: "red", failed: "red", skipped: "mute" },
  contract: { sent: "blue", signed: "sage", voided: "mute", expired: "mute" },
  event:    { new: "blue", classified: "blue", sent: "sage", acknowledged: "sage", dismissed: "mute" },
  product:  { active: "sage", in_progress: "gold", building: "gold", paused: "mute", disabled: "mute", unconfigured: "mute" },
};

export function statusTone(kind: StatusKind, status: string): Tone {
  return MAP[kind]?.[status] ?? "mute";
}

export function statusLabel(status: string): string {
  const s = status.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all `status` tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/status.ts lib/ui/status.test.ts
git commit -m "feat: status→tone map with tests"
```

---

### Task 4: Button

**Files:**
- Create: `components/ui/Button.tsx`
- Modify: `public/ui.css` (append `[Buttons]` block)

**Interfaces:**
- Consumes: `Icon`, `IconName` (Task 2).
- Produces: `export function Button(props: ButtonProps)` where
  `type ButtonProps = { variant?: "primary"|"secondary"|"ghost"|"danger"; size?: "sm"|"md"; loading?: boolean; icon?: IconName; iconRight?: IconName } & React.ComponentProps<"button">`. Defaults: `variant="primary"`, `size="md"`. (React 19: `ref` is a normal prop — no `forwardRef` needed.)

- [ ] **Step 1: Append the `[Buttons]` CSS to `public/ui.css`**

```css
/* === [Buttons] === */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--sp-2);
  font-family:var(--font-sans);font-size:var(--text-13);font-weight:var(--fw-med);line-height:1;
  letter-spacing:-.01em;padding:9px 16px;border-radius:var(--r);border:1px solid transparent;cursor:pointer;
  transition:background var(--dur),border-color var(--dur),box-shadow var(--dur),color var(--dur),transform var(--dur-fast);}
.btn:active{transform:translateY(.5px);}
.btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--gold-dim);}
.btn--sm{padding:6px 12px;font-size:var(--text-12);border-radius:var(--r-sm);}
.btn--primary{background:var(--bg-ink);color:var(--text-on-ink);}
.btn--primary:hover{background:#2A2D27;}
[data-theme="dark"] .btn--primary:hover{background:#cfc9b8;}
.btn--secondary{background:var(--bg-raised);border-color:var(--border);color:var(--text);}
.btn--secondary:hover{border-color:var(--text-soft);}
.btn--ghost{background:transparent;color:var(--text-soft);}
.btn--ghost:hover{background:var(--bg-raised);color:var(--text);}
.btn--danger{background:transparent;border-color:var(--red-dim);color:var(--red-text);}
.btn--danger:hover{background:var(--red-dim);border-color:var(--red);}
.btn:disabled,.btn[aria-disabled="true"]{opacity:.45;cursor:not-allowed;}
.btn__spin{width:14px;height:14px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;
  display:inline-block;animation:btnspin .7s linear infinite;}
@keyframes btnspin{to{transform:rotate(360deg);}}
@media (prefers-reduced-motion:reduce){.btn__spin{animation-duration:1.4s;}.btn{transition:none;}}
```

- [ ] **Step 2: Create `components/ui/Button.tsx`**

```tsx
"use client";
import * as React from "react";
import { Icon, type IconName } from "./icons";

type ButtonProps = {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  icon?: IconName;
  iconRight?: IconName;
} & React.ComponentProps<"button">;

export function Button({
  variant = "primary", size = "md", loading = false, icon, iconRight,
  children, className, disabled, ref, ...rest
}: ButtonProps) {
  const cls = [
    "btn", `btn--${variant}`, size === "sm" ? "btn--sm" : "", className,
  ].filter(Boolean).join(" ");
  return (
    <button ref={ref} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="btn__spin" /> : icon ? <Icon name={icon} size={14} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={14} /> : null}
    </button>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add components/ui/Button.tsx public/ui.css
git commit -m "feat: ink-forward Button with variants, loading, focus ring"
```

*(Visual verification happens in Task 14 on the `/ui` gallery.)*

---

### Task 5: Input, Textarea, Select

**Files:**
- Create: `components/ui/Field.tsx`
- Modify: `public/ui.css` (append `[Fields]`)

**Interfaces:**
- Produces:
  `export function Input(props: { label?: string; hint?: string; error?: string } & React.ComponentProps<"input">)`,
  `export function Textarea(props: { label?: string; hint?: string; error?: string; autoGrow?: boolean } & React.ComponentProps<"textarea">)`,
  `export function Select(props: { label?: string; hint?: string; error?: string; options: { value: string; label: string }[] } & React.ComponentProps<"select">)`. (React 19 ref-as-prop; ids via `React.useId()`.)

- [ ] **Step 1: Append `[Fields]` CSS to `public/ui.css`**

```css
/* === [Fields] === */
.field{display:flex;flex-direction:column;gap:6px;}
.field__label{font-size:var(--text-13);color:var(--text-soft);font-weight:var(--fw-med);}
.field__hint{font-size:var(--text-12);color:var(--text-mute);}
.field__error{font-size:var(--text-12);color:var(--red-text);}
.input,.select,.textarea{width:100%;font-family:var(--font-sans);font-size:var(--text-14);color:var(--text);
  background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--r);padding:10px 12px;outline:none;
  transition:border-color var(--dur),box-shadow var(--dur);}
.textarea{resize:vertical;min-height:84px;line-height:1.5;}
.input:focus,.select:focus,.textarea:focus{border-color:var(--gold);box-shadow:0 0 0 3px var(--gold-dim);}
.input::placeholder,.textarea::placeholder{color:var(--text-mute);}
.field--error .input,.field--error .select,.field--error .textarea{border-color:var(--red);box-shadow:0 0 0 3px var(--red-dim);}
.input:disabled,.select:disabled,.textarea:disabled{opacity:.55;cursor:not-allowed;}
@media (prefers-reduced-motion:reduce){.input,.select,.textarea{transition:none;}}
```

- [ ] **Step 2: Create `components/ui/Field.tsx`**

```tsx
"use client";
import * as React from "react";

function Wrap({ id, label, hint, error, children }: {
  id: string; label?: string; hint?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className={"field" + (error ? " field--error" : "")}>
      {label && <label className="field__label" htmlFor={id}>{label}</label>}
      {children}
      {error ? <span className="field__error" id={`${id}-err`}>{error}</span>
        : hint ? <span className="field__hint" id={`${id}-hint`}>{hint}</span> : null}
    </div>
  );
}

export function Input({ label, hint, error, id, ref, ...rest }:
  { label?: string; hint?: string; error?: string } & React.ComponentProps<"input">) {
  const auto = React.useId(); const realId = id ?? auto;
  return (
    <Wrap id={realId} label={label} hint={hint} error={error}>
      <input ref={ref} id={realId} className="input" aria-invalid={!!error || undefined}
        aria-describedby={error ? `${realId}-err` : hint ? `${realId}-hint` : undefined} {...rest} />
    </Wrap>
  );
}

export function Textarea({ label, hint, error, autoGrow, id, ref, onInput, ...rest }:
  { label?: string; hint?: string; error?: string; autoGrow?: boolean } & React.ComponentProps<"textarea">) {
  const auto = React.useId(); const realId = id ?? auto;
  function handleInput(e: React.FormEvent<HTMLTextAreaElement>) {
    if (autoGrow) { const el = e.currentTarget; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
    onInput?.(e);
  }
  return (
    <Wrap id={realId} label={label} hint={hint} error={error}>
      <textarea ref={ref} id={realId} className="textarea" onInput={handleInput} aria-invalid={!!error || undefined}
        aria-describedby={error ? `${realId}-err` : hint ? `${realId}-hint` : undefined} {...rest} />
    </Wrap>
  );
}

export function Select({ label, hint, error, options, id, ref, ...rest }:
  { label?: string; hint?: string; error?: string; options: { value: string; label: string }[] } & React.ComponentProps<"select">) {
  const auto = React.useId(); const realId = id ?? auto;
  return (
    <Wrap id={realId} label={label} hint={hint} error={error}>
      <select ref={ref} id={realId} className="select" aria-invalid={!!error || undefined}
        aria-describedby={error ? `${realId}-err` : hint ? `${realId}-hint` : undefined} {...rest}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Wrap>
  );
}
```

- [ ] **Step 3: Typecheck** — Run: `npm run typecheck` → exits 0.

- [ ] **Step 4: Commit**

```bash
git add components/ui/Field.tsx public/ui.css
git commit -m "feat: Input/Textarea/Select with labels, hints, error state"
```

---

### Task 6: Card + Badge/StatusPill

**Files:**
- Create: `components/ui/Card.tsx`
- Create: `components/ui/Badge.tsx`
- Modify: `public/ui.css` (append `[Card]`, `[Badge]`)

**Interfaces:**
- Consumes: `statusTone`, `statusLabel`, `Tone`, `StatusKind` (Task 3).
- Produces:
  `export function Card(props: { title?: React.ReactNode; action?: React.ReactNode; elevation?: 0|1|2; className?: string; children: React.ReactNode })`,
  `export function Badge(props: { tone?: Tone; children: React.ReactNode })`,
  `export function StatusPill(props: { kind: StatusKind; status: string })`.

- [ ] **Step 1: Append `[Card]` and `[Badge]` CSS to `public/ui.css`**

```css
/* === [Card] === */
.card{background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--r-lg);padding:var(--sp-6);}
.card--el1{box-shadow:var(--el-1);} .card--el2{box-shadow:var(--el-2);}
.card__head{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3);margin-bottom:var(--sp-4);}
.card__title{font-size:var(--text-16);font-weight:var(--fw-med);letter-spacing:-.01em;margin:0;}

/* === [Badge] === */
.badge{display:inline-flex;align-items:center;gap:5px;font-family:var(--font-mono);font-size:var(--text-9);
  font-weight:var(--fw-med);letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:var(--r-pill);
  border:1px solid transparent;white-space:nowrap;}
.badge--sage{background:var(--sage-dim);color:var(--sage-text);border-color:var(--sage-dim);}
.badge--gold{background:var(--gold-dim);color:var(--gold-text);border-color:var(--gold-dim);}
.badge--red{background:var(--red-dim);color:var(--red-text);border-color:var(--red-dim);}
.badge--blue{background:var(--blue-dim);color:var(--blue-text);border-color:var(--blue-dim);}
.badge--mute{background:var(--bg-sunken);color:var(--text-mute);border-color:var(--border);}
```

- [ ] **Step 2: Create `components/ui/Card.tsx`**

```tsx
import * as React from "react";

export function Card({ title, action, elevation = 0, className, children }: {
  title?: React.ReactNode; action?: React.ReactNode; elevation?: 0 | 1 | 2; className?: string; children: React.ReactNode;
}) {
  const cls = ["card", elevation === 1 ? "card--el1" : elevation === 2 ? "card--el2" : "", className]
    .filter(Boolean).join(" ");
  return (
    <div className={cls}>
      {(title || action) && (
        <div className="card__head">
          {title ? <h3 className="card__title">{title}</h3> : <span />}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Create `components/ui/Badge.tsx`**

```tsx
import * as React from "react";
import { statusTone, statusLabel, type Tone, type StatusKind } from "@/lib/ui/status";

export function Badge({ tone = "mute", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function StatusPill({ kind, status }: { kind: StatusKind; status: string }) {
  return <Badge tone={statusTone(kind, status)}>{statusLabel(status)}</Badge>;
}
```

- [ ] **Step 4: Typecheck** — Run: `npm run typecheck` → exits 0.

- [ ] **Step 5: Commit**

```bash
git add components/ui/Card.tsx components/ui/Badge.tsx public/ui.css
git commit -m "feat: Card + Badge/StatusPill mapped to status enums"
```

---

### Task 7: Skeleton + EmptyState

**Files:**
- Create: `components/ui/Skeleton.tsx`
- Create: `components/ui/EmptyState.tsx`
- Modify: `public/ui.css` (append `[Skeleton]`, `[EmptyState]`)

**Interfaces:**
- Consumes: `Icon`, `IconName` (Task 2).
- Produces:
  `export function Skeleton(props: { variant?: "text"|"row"|"card"|"stat"|"circle"; width?: string|number; height?: string|number; count?: number; className?: string })`,
  `export function EmptyState(props: { icon?: IconName; title: string; children?: React.ReactNode; action?: React.ReactNode })`.

- [ ] **Step 1: Append `[Skeleton]` + `[EmptyState]` CSS to `public/ui.css`**

```css
/* === [Skeleton] === */
.skel{position:relative;overflow:hidden;background:var(--bg-sunken);border-radius:var(--r-sm);}
.skel::after{content:"";position:absolute;inset:0;transform:translateX(-100%);
  background:linear-gradient(90deg,transparent,rgba(255,252,245,.55),transparent);animation:skelsweep 1.5s ease-in-out infinite;}
[data-theme="dark"] .skel::after{background:linear-gradient(90deg,transparent,rgba(255,255,255,.06),transparent);}
@keyframes skelsweep{to{transform:translateX(100%);}}
.skel--text{height:12px;border-radius:6px;} .skel--row{height:56px;border-radius:var(--r);}
.skel--card{height:120px;border-radius:var(--r-lg);} .skel--stat{height:92px;border-radius:var(--r-lg);}
.skel--circle{border-radius:50%;}
@media (prefers-reduced-motion:reduce){.skel::after{animation:none;}.skel{opacity:.8;}}

/* === [EmptyState] === */
.empty{text-align:center;padding:var(--sp-12) var(--sp-6);}
.empty__icon{width:46px;height:46px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
  margin-bottom:var(--sp-4);background:var(--sage-dim);border:1px solid var(--sage-dim);color:var(--sage-text);}
.empty__title{font-family:var(--font-serif);font-weight:var(--fw-med);font-size:var(--text-22);color:var(--text);margin:0 0 6px;}
.empty__body{font-size:var(--text-13);color:var(--text-soft);margin:0 0 var(--sp-4);}
```

- [ ] **Step 2: Create `components/ui/Skeleton.tsx`**

```tsx
import * as React from "react";

export function Skeleton({ variant = "text", width, height, count = 1, className }: {
  variant?: "text" | "row" | "card" | "stat" | "circle"; width?: string | number; height?: string | number;
  count?: number; className?: string;
}) {
  const style: React.CSSProperties = {};
  if (width != null) style.width = typeof width === "number" ? `${width}px` : width;
  if (height != null) style.height = typeof height === "number" ? `${height}px` : height;
  const cls = ["skel", `skel--${variant}`, className].filter(Boolean).join(" ");
  return <>{Array.from({ length: count }, (_, i) => <div key={i} className={cls} style={style} aria-hidden="true" />)}</>;
}
```

- [ ] **Step 3: Create `components/ui/EmptyState.tsx`**

```tsx
import * as React from "react";
import { Icon, type IconName } from "./icons";

export function EmptyState({ icon = "inbox", title, children, action }: {
  icon?: IconName; title: string; children?: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty__icon"><Icon name={icon} size={22} /></span>
      <h3 className="empty__title">{title}</h3>
      {children && <p className="empty__body">{children}</p>}
      {action}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck** — Run: `npm run typecheck` → exits 0.

- [ ] **Step 5: Commit**

```bash
git add components/ui/Skeleton.tsx components/ui/EmptyState.tsx public/ui.css
git commit -m "feat: shimmer Skeleton family + EmptyState"
```

---

### Task 8: Toast system (provider + hook + UI)

**Files:**
- Create: `components/ui/Toast.tsx`
- Modify: `public/ui.css` (append `[Toast]`)

**Interfaces:**
- Consumes: `Icon` (Task 2).
- Produces:
  `export function ToastProvider({ children }: { children: React.ReactNode })`,
  `export function useToast(): { toast: (opts: ToastOptions) => void }` where
  `type ToastOptions = { message: string; tone?: "sage"|"gold"|"red"; undo?: () => void; duration?: number }`.
  `ToastProvider` must wrap any tree that calls `useToast`.

- [ ] **Step 1: Append `[Toast]` CSS to `public/ui.css`**

```css
/* === [Toast] === */
.toast-region{position:fixed;right:var(--sp-5);bottom:var(--sp-5);z-index:var(--z-toast);
  display:flex;flex-direction:column;gap:var(--sp-2);max-width:360px;}
.toast{display:flex;align-items:center;gap:var(--sp-3);background:var(--bg-ink);color:var(--text-on-ink);
  border-radius:var(--r);padding:12px 14px;box-shadow:var(--el-3);position:relative;overflow:hidden;
  animation:toastin var(--dur) var(--ease-out);}
@keyframes toastin{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}
.toast__icon{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.toast--sage .toast__icon{background:var(--sage-dim);color:var(--sage);}
.toast--gold .toast__icon{background:var(--gold-dim);color:var(--gold);}
.toast--red .toast__icon{background:var(--red-dim);color:var(--red);}
.toast__msg{font-size:var(--text-13);flex:1;}
.toast__undo{display:inline-flex;align-items:center;gap:5px;font-family:var(--font-mono);font-size:var(--text-11);
  font-weight:var(--fw-med);text-transform:uppercase;letter-spacing:.06em;color:var(--gold);background:none;border:none;cursor:pointer;}
.toast__undo:focus-visible{outline:none;box-shadow:0 0 0 3px var(--gold-dim);border-radius:var(--r-sm);}
.toast__bar{position:absolute;left:0;bottom:0;width:100%;height:2px;background:var(--gold);transform-origin:left;}
@media (prefers-reduced-motion:reduce){.toast{animation:none;}.toast__bar{display:none;}}
```

- [ ] **Step 2: Create `components/ui/Toast.tsx`**

```tsx
"use client";
import * as React from "react";
import { Icon } from "./icons";

type ToastOptions = { message: string; tone?: "sage" | "gold" | "red"; undo?: () => void; duration?: number };
type ToastItem = ToastOptions & { id: number };

const Ctx = React.createContext<{ toast: (o: ToastOptions) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const idRef = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = React.useCallback((o: ToastOptions) => {
    const id = ++idRef.current;
    const duration = o.duration ?? 5000;
    setItems(prev => [...prev, { ...o, id }]);
    window.setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toast-region" role="region" aria-live="polite" aria-label="Notifications">
        {items.map(t => {
          const tone = t.tone ?? "sage";
          const duration = t.duration ?? 5000;
          return (
            <div key={t.id} className={`toast toast--${tone}`}>
              <span className="toast__icon"><Icon name="check" size={13} /></span>
              <span className="toast__msg">{t.message}</span>
              {t.undo && (
                <button className="toast__undo" onClick={() => { t.undo!(); dismiss(t.id); }}>
                  <Icon name="undo" size={13} />Undo
                </button>
              )}
              <span className="toast__bar" style={{ animation: `toastbar ${duration}ms linear forwards` }} />
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
```

- [ ] **Step 3: Add the `toastbar` keyframe to `public/ui.css`** (append under `[Toast]`)

```css
@keyframes toastbar{from{transform:scaleX(1);}to{transform:scaleX(0);}}
```

- [ ] **Step 4: Typecheck** — Run: `npm run typecheck` → exits 0.

- [ ] **Step 5: Commit**

```bash
git add components/ui/Toast.tsx public/ui.css
git commit -m "feat: global Toast provider with optimistic Undo"
```

---

### Task 9: Modal + Drawer (focus-trapped)

**Files:**
- Create: `components/ui/useFocusTrap.ts`
- Create: `components/ui/Modal.tsx`
- Modify: `public/ui.css` (append `[Modal/Drawer]`)

**Interfaces:**
- Consumes: `Icon` (Task 2).
- Produces:
  `export function useFocusTrap(active: boolean, onClose: () => void): React.RefObject<HTMLDivElement | null>`,
  `export function Modal(props: { open: boolean; onClose: () => void; title?: string; footer?: React.ReactNode; children: React.ReactNode })`,
  `export function Drawer(props: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode })`.

- [ ] **Step 1: Append `[Modal/Drawer]` CSS to `public/ui.css`**

```css
/* === [Modal/Drawer] === */
.scrim{position:fixed;inset:0;background:rgba(20,20,18,.45);z-index:var(--z-modal);
  display:flex;align-items:center;justify-content:center;padding:var(--sp-5);animation:fade var(--dur) ease;}
@keyframes fade{from{opacity:0;}to{opacity:1;}}
.modal{background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--r-lg);box-shadow:var(--el-3);
  width:100%;max-width:460px;max-height:90vh;overflow:auto;animation:modalin var(--dur) var(--ease-out);}
@keyframes modalin{from{opacity:0;transform:translateY(8px) scale(.99);}to{opacity:1;transform:none;}}
.modal__head{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3);
  padding:var(--sp-5) var(--sp-5) var(--sp-3);}
.modal__title{font-family:var(--font-serif);font-size:var(--text-22);font-weight:var(--fw-med);margin:0;}
.modal__x{background:none;border:none;color:var(--text-mute);cursor:pointer;padding:4px;border-radius:var(--r-sm);}
.modal__x:hover{color:var(--text);background:var(--bg-sunken);}
.modal__x:focus-visible{outline:none;box-shadow:0 0 0 3px var(--gold-dim);border-radius:var(--r-sm);}
.modal__body{padding:0 var(--sp-5) var(--sp-5);}
.modal__foot{display:flex;justify-content:flex-end;gap:var(--sp-2);padding:var(--sp-4) var(--sp-5);border-top:1px solid var(--border);}
.scrim--drawer{justify-content:flex-end;padding:0;}
.drawer{background:var(--bg-raised);border-left:1px solid var(--border);box-shadow:var(--el-3);
  width:100%;max-width:440px;height:100vh;overflow:auto;animation:drawerin var(--dur) var(--ease-out);}
@keyframes drawerin{from{transform:translateX(24px);opacity:0;}to{transform:none;opacity:1;}}
@media (prefers-reduced-motion:reduce){.scrim,.modal,.drawer{animation:none;}}
```

- [ ] **Step 2: Create `components/ui/useFocusTrap.ts`**

```tsx
"use client";
import * as React from "react";

const SELECTOR = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function useFocusTrap(active: boolean, onClose: () => void) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!active) return;
    const node = ref.current;
    const prevFocus = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(node?.querySelectorAll<HTMLElement>(SELECTOR) ?? []);
    focusables()[0]?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const els = focusables(); if (els.length === 0) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prevFocus?.focus(); };
  }, [active, onClose]);
  return ref;
}
```

- [ ] **Step 3: Create `components/ui/Modal.tsx`**

```tsx
"use client";
import * as React from "react";
import { Icon } from "./icons";
import { useFocusTrap } from "./useFocusTrap";

export function Modal({ open, onClose, title, footer, children }: {
  open: boolean; onClose: () => void; title?: string; footer?: React.ReactNode; children: React.ReactNode;
}) {
  const ref = useFocusTrap(open, onClose);
  if (!open) return null;
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        {title && (
          <div className="modal__head">
            <h2 className="modal__title">{title}</h2>
            <button className="modal__x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
          </div>
        )}
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title?: string; children: React.ReactNode;
}) {
  const ref = useFocusTrap(open, onClose);
  if (!open) return null;
  return (
    <div className="scrim scrim--drawer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        {title && (
          <div className="modal__head">
            <h2 className="modal__title">{title}</h2>
            <button className="modal__x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
          </div>
        )}
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck** — Run: `npm run typecheck` → exits 0.

- [ ] **Step 5: Commit**

```bash
git add components/ui/useFocusTrap.ts components/ui/Modal.tsx public/ui.css
git commit -m "feat: focus-trapped Modal + Drawer"
```

---

### Task 10: Tabs, Breadcrumbs, Avatar, Tooltip

**Files:**
- Create: `components/ui/Tabs.tsx`, `components/ui/Breadcrumbs.tsx`, `components/ui/Avatar.tsx`, `components/ui/Tooltip.tsx`
- Modify: `public/ui.css` (append `[Tabs]`, `[Breadcrumbs]`, `[Avatar]`, `[Tooltip]`)

**Interfaces:**
- Produces:
  `export function Tabs(props: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void })`,
  `export function Breadcrumbs(props: { items: { label: string; href?: string }[] })`,
  `export function Avatar(props: { initials: string; size?: "sm"|"md" })`,
  `export function Tooltip(props: { content: string; children: React.ReactNode })`.

- [ ] **Step 1: Append CSS to `public/ui.css`**

```css
/* === [Tabs] === */
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);}
.tab{font-family:var(--font-sans);font-size:var(--text-13);font-weight:var(--fw-med);color:var(--text-soft);
  background:none;border:none;padding:10px 14px;cursor:pointer;position:relative;border-radius:var(--r-sm) var(--r-sm) 0 0;}
.tab:hover{color:var(--text);}
.tab.is-active{color:var(--text);}
.tab.is-active::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:2px;background:var(--gold);border-radius:2px;}
.tab:focus-visible{outline:none;box-shadow:0 0 0 3px var(--gold-dim);border-radius:var(--r-sm);}
/* === [Breadcrumbs] === */
.crumbs{display:flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:var(--text-10);
  letter-spacing:.05em;text-transform:uppercase;color:var(--text-mute);}
.crumb{color:var(--text-mute);} .crumb:hover{color:var(--text-soft);}
.crumb:focus-visible{outline:none;box-shadow:0 0 0 3px var(--gold-dim);border-radius:var(--r-sm);}
.crumb.is-current{color:var(--text);}
.crumbs__sep{color:var(--gold-deep);}
/* === [Avatar] === */
.avatar{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:var(--bg-raised);
  border:1.5px solid var(--gold);color:var(--text);font-family:var(--font-mono);font-weight:var(--fw-med);
  width:30px;height:30px;font-size:var(--text-11);flex-shrink:0;}
.avatar--sm{width:26px;height:26px;font-size:var(--text-10);}
/* === [Tooltip] === */
.tip{position:relative;display:inline-flex;}
.tip__bubble{position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%) translateY(4px);
  background:var(--text);color:var(--bg);font-family:var(--font-sans);font-size:var(--text-12);line-height:1.4;
  padding:8px 10px;border-radius:var(--r-sm);box-shadow:var(--el-2);width:max-content;max-width:240px;
  opacity:0;pointer-events:none;transition:opacity var(--dur),transform var(--dur);z-index:var(--z-tooltip);}
.tip:hover .tip__bubble,.tip:focus-within .tip__bubble{opacity:1;transform:translateX(-50%) translateY(0);}
@media (prefers-reduced-motion:reduce){.tip__bubble{transition:none;}}
```

- [ ] **Step 2: Create the four components**

`components/ui/Tabs.tsx`:
```tsx
"use client";
import * as React from "react";
export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  function onKey(e: React.KeyboardEvent) {
    const i = tabs.findIndex(t => t.id === active);
    if (e.key === "ArrowRight") { e.preventDefault(); onChange(tabs[(i + 1) % tabs.length].id); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); onChange(tabs[(i - 1 + tabs.length) % tabs.length].id); }
  }
  return (
    <div className="tabs" role="tablist" onKeyDown={onKey}>
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={t.id === active} tabIndex={t.id === active ? 0 : -1}
          className={"tab" + (t.id === active ? " is-active" : "")} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

`components/ui/Breadcrumbs.tsx`:
```tsx
import * as React from "react";
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="crumbs__sep" aria-hidden="true">/</span>}
          {it.href && i < items.length - 1
            ? <a className="crumb" href={it.href}>{it.label}</a>
            : <span className="crumb is-current" aria-current="page">{it.label}</span>}
        </React.Fragment>
      ))}
    </nav>
  );
}
```

`components/ui/Avatar.tsx`:
```tsx
import * as React from "react";
export function Avatar({ initials, size = "md" }: { initials: string; size?: "sm" | "md" }) {
  return <span className={"avatar" + (size === "sm" ? " avatar--sm" : "")} aria-hidden="true">{initials}</span>;
}
```

`components/ui/Tooltip.tsx`:
```tsx
import * as React from "react";
export function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  return <span className="tip">{children}<span className="tip__bubble" role="tooltip">{content}</span></span>;
}
```

- [ ] **Step 3: Typecheck** — Run: `npm run typecheck` → exits 0.

- [ ] **Step 4: Commit**

```bash
git add components/ui/Tabs.tsx components/ui/Breadcrumbs.tsx components/ui/Avatar.tsx components/ui/Tooltip.tsx public/ui.css
git commit -m "feat: Tabs, Breadcrumbs, Avatar, Tooltip primitives"
```

---

### Task 11: Command registry filter (TDD)

**Files:**
- Create: `lib/ui/commands.ts`
- Test: `lib/ui/commands.test.ts`

**Interfaces:**
- Produces:
  `export type Command = { id: string; label: string; group?: string; keywords?: string };`
  `export function filterCommands<T extends Command>(commands: T[], query: string): T[];`
  Matching is case-insensitive substring over `label` + `keywords`; empty query returns all (original order); results ranked by match position (earlier = higher).

- [ ] **Step 1: Write the failing test** — create `lib/ui/commands.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { filterCommands, type Command } from "./commands";

const cmds: Command[] = [
  { id: "dash", label: "Go to Dashboard" },
  { id: "tix", label: "New ticket", keywords: "support help" },
  { id: "conn", label: "Manage connections" },
];

test("empty query returns all in original order", () => {
  assert.deepEqual(filterCommands(cmds, "").map(c => c.id), ["dash", "tix", "conn"]);
});

test("substring matches label", () => {
  assert.deepEqual(filterCommands(cmds, "dash").map(c => c.id), ["dash"]);
});

test("matches keywords too", () => {
  assert.deepEqual(filterCommands(cmds, "help").map(c => c.id), ["tix"]);
});

test("earlier match ranks higher", () => {
  // "con" is at index 0 of "Manage connections"? no -> appears in "connections"
  const r = filterCommands(cmds, "connect");
  assert.equal(r[0].id, "conn");
});

test("no match returns empty", () => {
  assert.deepEqual(filterCommands(cmds, "zzz"), []);
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npm test` → FAIL (`Cannot find module './commands'`).

- [ ] **Step 3: Write the implementation** — create `lib/ui/commands.ts`:

```ts
export type Command = { id: string; label: string; group?: string; keywords?: string };

export function filterCommands<T extends Command>(commands: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  const scored: { c: T; pos: number }[] = [];
  for (const c of commands) {
    const hay = `${c.label} ${c.keywords ?? ""}`.toLowerCase();
    const pos = hay.indexOf(q);
    if (pos !== -1) scored.push({ c, pos });
  }
  scored.sort((a, b) => a.pos - b.pos);
  return scored.map(s => s.c);
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/commands.ts lib/ui/commands.test.ts
git commit -m "feat: command-palette filter with tests"
```

---

### Task 12: Command palette (⌘K)

**Files:**
- Create: `components/ui/CommandPalette.tsx`
- Modify: `public/ui.css` (append `[CommandPalette]`)

**Interfaces:**
- Consumes: `filterCommands`, `Command` (Task 11); `Icon`, `IconName` (Task 2); `useFocusTrap` (Task 9).
- Produces: `export type PaletteCommand = Command & { icon?: IconName; run: () => void };`
  `export function useCommandK(): [boolean, React.Dispatch<React.SetStateAction<boolean>>]` — owns palette open-state + the global ⌘K/Ctrl+K toggle listener.
  `export function CommandPalette({ commands, open, onOpenChange }: { commands: PaletteCommand[]; open: boolean; onOpenChange: (v: boolean) => void })` — **controlled** (no internal toggle/synthetic events); renders the palette and the combobox/listbox a11y wiring.

- [ ] **Step 1: Append `[CommandPalette]` CSS to `public/ui.css`**

```css
/* === [CommandPalette] === */
.cmdk-scrim{position:fixed;inset:0;background:rgba(20,20,18,.45);z-index:var(--z-cmdk);
  display:flex;align-items:flex-start;justify-content:center;padding-top:14vh;animation:fade var(--dur) ease;}
.cmdk{background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--r-lg);box-shadow:var(--el-3);
  width:100%;max-width:540px;overflow:hidden;animation:modalin var(--dur) var(--ease-out);}
.cmdk__input{width:100%;border:none;border-bottom:1px solid var(--border);background:none;outline:none;
  font-family:var(--font-sans);font-size:var(--text-16);color:var(--text);padding:16px 18px;}
.cmdk__input::placeholder{color:var(--text-mute);}
.cmdk__list{max-height:340px;overflow:auto;padding:6px;}
.cmdk__item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--r-sm);cursor:pointer;
  font-size:var(--text-13);color:var(--text-soft);}
.cmdk__item .icn{color:var(--text-mute);}
.cmdk__item.is-active{background:var(--gold-dim);color:var(--text);}
.cmdk__item.is-active .icn{color:var(--gold-deep);}
.cmdk__empty{padding:24px;text-align:center;color:var(--text-mute);font-size:var(--text-13);}
@media (prefers-reduced-motion:reduce){.cmdk-scrim,.cmdk{animation:none;}}
```

- [ ] **Step 2: Create `components/ui/CommandPalette.tsx`**

```tsx
"use client";
import * as React from "react";
import { Icon, type IconName } from "./icons";
import { useFocusTrap } from "./useFocusTrap";
import { filterCommands, type Command } from "@/lib/ui/commands";

export type PaletteCommand = Command & { icon?: IconName; run: () => void };

// Owns open-state + the global ⌘K / Ctrl+K toggle. Used by AppShell and the gallery.
export function useCommandK(): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(o => !o); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen];
}

export function CommandPalette({ commands, open, onOpenChange }: {
  commands: PaletteCommand[]; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const ref = useFocusTrap(open, () => onOpenChange(false));

  React.useEffect(() => { if (open) { setQuery(""); setActive(0); } }, [open]);
  const results = filterCommands(commands, query);
  React.useEffect(() => { setActive(0); }, [query]);

  function onListKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const c = results[active]; if (c) { c.run(); onOpenChange(false); } }
  }

  if (!open) return null;
  const activeId = results[active] ? `cmdk-opt-${results[active].id}` : undefined;
  return (
    <div className="cmdk-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette" ref={ref} onKeyDown={onListKey}>
        <input className="cmdk__input" placeholder="Search pages and actions…" value={query} autoFocus
          onChange={(e) => setQuery(e.target.value)} aria-label="Command search"
          role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={activeId} />
        <div className="cmdk__list" id="cmdk-list" role="listbox">
          {results.length === 0 ? <div className="cmdk__empty">No matches</div> : results.map((c, i) => (
            <div key={c.id} id={`cmdk-opt-${c.id}`} role="option" aria-selected={i === active}
              className={"cmdk__item" + (i === active ? " is-active" : "")}
              onMouseEnter={() => setActive(i)} onClick={() => { c.run(); onOpenChange(false); }}>
              {c.icon && <Icon name={c.icon} size={15} className="icn" />}
              <span>{c.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck** — Run: `npm run typecheck` → exits 0.

- [ ] **Step 4: Commit**

```bash
git add components/ui/CommandPalette.tsx public/ui.css
git commit -m "feat: ⌘K command palette"
```

---

### Task 13: Cockpit shell + theme toggle

**Files:**
- Create: `components/ui/ThemeToggle.tsx`
- Create: `components/shell/AppShell.tsx`
- Modify: `public/ui.css` (append `[Shell]`)

**Interfaces:**
- Consumes: `Icon`, `IconName` (Task 2); `Avatar` (Task 10); `Breadcrumbs` (Task 10); `ToastProvider` (Task 8); `CommandPalette`, `useCommandK`, `PaletteCommand` (Task 12).
- Produces:
  `export function ThemeToggle({ storageKey }: { storageKey: string })`,
  `export type NavItem = { label: string; href: string; icon: IconName; dot?: "live"|"idle"|"paused"; badge?: string };`
  `export type NavSection = { label?: string; items: NavItem[] };`
  `export function AppShell(props: { nav: NavSection[]; user: { name: string; company?: string; initials: string }; activePath: string; breadcrumbs?: { label: string; href?: string }[]; commands?: PaletteCommand[]; themeStorageKey?: string; children: React.ReactNode })`.

- [ ] **Step 1: Append `[Shell]` CSS to `public/ui.css`**

```css
/* === [Shell] === */
.app-shell{display:grid;grid-template-columns:236px 1fr;min-height:100vh;background:var(--bg);}
.app-rail{position:sticky;top:0;align-self:start;height:100vh;overflow-y:auto;display:flex;flex-direction:column;
  background:var(--bg-raised);border-right:1px solid var(--border);padding:16px 12px;z-index:var(--z-rail);}
.app-rail__head{display:flex;align-items:center;justify-content:space-between;padding:0 8px 14px;border-bottom:1px solid var(--border);}
.app-rail__brand{font-family:var(--font-sans);font-weight:var(--fw-semi);font-size:var(--text-16);letter-spacing:-.03em;color:var(--text);}
.app-rail__brand em{font-family:var(--font-serif);font-style:italic;font-weight:var(--fw-med);color:var(--gold-deep);}
.app-rail__live{display:flex;align-items:center;gap:5px;font-family:var(--font-mono);font-size:var(--text-9);
  letter-spacing:.08em;text-transform:uppercase;color:var(--sage-text);}
.app-rail__live i{width:6px;height:6px;border-radius:50%;background:var(--sage);box-shadow:0 0 0 3px var(--sage-dim);}
.app-rail__nav{display:flex;flex-direction:column;gap:1px;padding:10px 0;flex:1;}
.app-rail__group-label{font-family:var(--font-mono);font-size:var(--text-9);letter-spacing:.11em;text-transform:uppercase;
  color:var(--text-mute);padding:12px 10px 6px;}
.app-rail__item{display:flex;align-items:center;gap:11px;padding:8px 10px;border-radius:var(--r-sm);
  color:var(--text-soft);text-decoration:none;position:relative;transition:background var(--dur-fast),color var(--dur-fast);}
.app-rail__item:hover{background:var(--bg-sunken);color:var(--text);}
.app-rail__item:focus-visible{outline:none;box-shadow:0 0 0 3px var(--gold-dim);}
.app-rail__item.is-active{background:var(--gold-dim);color:var(--text);font-weight:var(--fw-med);}
.app-rail__item.is-active::before{content:"";position:absolute;left:-12px;top:7px;bottom:7px;width:2.5px;
  background:var(--gold);border-radius:0 3px 3px 0;}
.app-rail__item .icn{color:var(--text-mute);flex-shrink:0;}
.app-rail__item.is-active .icn{color:var(--gold-deep);}
.app-rail__label{flex:1;font-size:var(--text-13);}
.app-rail__dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
.app-rail__dot--live{background:var(--sage);box-shadow:0 0 0 3px var(--sage-dim);}
.app-rail__dot--idle{background:var(--text-mute);} .app-rail__dot--paused{background:var(--gold);}
.app-rail__badge{font-family:var(--font-mono);font-size:var(--text-9);background:var(--gold);color:var(--bg-ink);
  padding:1px 6px;border-radius:var(--r-sm);}
.app-rail__foot{margin-top:auto;display:flex;align-items:center;gap:9px;padding:12px 8px 0;border-top:1px solid var(--border);}
.app-rail__foot .nm{display:flex;flex-direction:column;line-height:1.25;min-width:0;}
.app-rail__foot .nm b{font-size:var(--text-12);font-weight:var(--fw-med);color:var(--text);}
.app-rail__foot .nm span{font-size:var(--text-10);color:var(--text-mute);font-family:var(--font-mono);}
.app-topbar{position:sticky;top:0;z-index:var(--z-topbar);display:flex;align-items:center;gap:var(--sp-3);
  height:52px;padding:0 var(--sp-6);border-bottom:1px solid var(--border);
  background:color-mix(in srgb,var(--bg-raised) 80%,transparent);backdrop-filter:blur(8px);}
.app-topbar__spacer{flex:1;}
.app-topbar__search{display:flex;align-items:center;gap:8px;font-size:var(--text-12);color:var(--text-mute);
  background:var(--bg-sunken);border:1px solid var(--border);border-radius:var(--r-pill);padding:5px 11px;cursor:pointer;}
.app-topbar__search kbd{font-family:var(--font-mono);font-size:var(--text-9);background:var(--bg);border:1px solid var(--border);
  border-radius:4px;padding:1px 5px;color:var(--text-mute);}
.app-topbar__search:focus-visible{outline:none;box-shadow:0 0 0 3px var(--gold-dim);}
.app-iconbtn{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;
  color:var(--text-soft);background:none;border:1px solid transparent;cursor:pointer;}
.app-iconbtn:hover{border-color:var(--border);background:var(--bg-sunken);}
.app-iconbtn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--gold-dim);}
.app-main{min-width:0;}
.app-content{padding:var(--sp-8) var(--sp-8) var(--sp-20);}
.app-content--calm{max-width:900px;margin:0 auto;}
.skip-link{position:absolute;left:-9999px;top:0;z-index:var(--z-cmdk);background:var(--bg-ink);color:var(--text-on-ink);
  padding:8px 14px;font-size:var(--text-13);border-radius:0 0 var(--r) 0;}
.skip-link:focus{left:0;}
.app-hamburger{display:none;}
@media (max-width:760px){
  .app-shell{grid-template-columns:1fr;}
  .app-rail{position:fixed;left:0;top:0;width:260px;transform:translateX(-100%);transition:transform var(--dur) var(--ease);box-shadow:var(--el-3);}
  .app-rail.is-open{transform:none;}
  .app-hamburger{display:flex;}
  .app-content{padding:var(--sp-6) var(--sp-5) var(--sp-16);}
}
@media (prefers-reduced-motion:reduce){.app-rail{transition:none;}}
```

- [ ] **Step 2: Create `components/ui/ThemeToggle.tsx`**

```tsx
"use client";
import * as React from "react";
import { Icon } from "./icons";

export function ThemeToggle({ storageKey }: { storageKey: string }) {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => { setDark(document.documentElement.getAttribute("data-theme") === "dark"); }, []);
  function toggle() {
    const next = !dark; setDark(next);
    if (next) { document.documentElement.setAttribute("data-theme", "dark"); localStorage.setItem(storageKey, "dark"); }
    else { document.documentElement.removeAttribute("data-theme"); localStorage.setItem(storageKey, "light"); }
  }
  return (
    <button className="app-iconbtn" onClick={toggle} aria-label="Toggle dark mode">
      <Icon name={dark ? "sun" : "moon"} size={16} />
    </button>
  );
}
```

- [ ] **Step 3: Create `components/shell/AppShell.tsx`**

```tsx
"use client";
import * as React from "react";
import { Icon, type IconName } from "@/components/ui/icons";
import { Avatar } from "@/components/ui/Avatar";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { ToastProvider } from "@/components/ui/Toast";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { CommandPalette, useCommandK, type PaletteCommand } from "@/components/ui/CommandPalette";

export type NavItem = { label: string; href: string; icon: IconName; dot?: "live" | "idle" | "paused"; badge?: string };
export type NavSection = { label?: string; items: NavItem[] };

export function AppShell({
  nav, user, activePath, breadcrumbs, commands = [], themeStorageKey = "gb2g_portal_theme", children,
}: {
  nav: NavSection[];
  user: { name: string; company?: string; initials: string };
  activePath: string; breadcrumbs?: { label: string; href?: string }[];
  commands?: PaletteCommand[]; themeStorageKey?: string; children: React.ReactNode;
}) {
  const [railOpen, setRailOpen] = React.useState(false);
  const [cmdkOpen, setCmdkOpen] = useCommandK();
  return (
    <ToastProvider>
      <a href="#app-main" className="skip-link">Skip to main content</a>
      <div className="app-shell">
        <nav className={"app-rail" + (railOpen ? " is-open" : "")} aria-label="Primary">
          <div className="app-rail__head">
            <span className="app-rail__brand">gb<em>2</em>g</span>
            <span className="app-rail__live"><i />Live</span>
          </div>
          <div className="app-rail__nav">
            {nav.map((section, si) => (
              <React.Fragment key={si}>
                {section.label && <div className="app-rail__group-label">{section.label}</div>}
                {section.items.map(it => {
                  const active = activePath === it.href || activePath.startsWith(it.href + "/");
                  return (
                    <a key={it.href} href={it.href} aria-current={active ? "page" : undefined}
                      className={"app-rail__item" + (active ? " is-active" : "")}>
                      <Icon name={it.icon} size={16} className="icn" />
                      <span className="app-rail__label">{it.label}</span>
                      {it.badge && <span className="app-rail__badge">{it.badge}</span>}
                      {it.dot && <span className={`app-rail__dot app-rail__dot--${it.dot}`} aria-hidden="true" />}
                    </a>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          <div className="app-rail__foot">
            <Avatar initials={user.initials} size="sm" />
            <span className="nm"><b>{user.name}</b>{user.company && <span>{user.company}</span>}</span>
          </div>
        </nav>

        <div className="app-main">
          <header className="app-topbar">
            <button className="app-iconbtn app-hamburger" aria-label="Menu" onClick={() => setRailOpen(o => !o)}>
              <Icon name="menu" size={16} />
            </button>
            {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
            <span className="app-topbar__spacer" />
            {commands.length > 0 && (
              <button className="app-topbar__search" onClick={() => setCmdkOpen(true)}>
                <Icon name="search" size={14} />Search<kbd>⌘K</kbd>
              </button>
            )}
            <button className="app-iconbtn" aria-label="Notifications"><Icon name="bell" size={16} /></button>
            <ThemeToggle storageKey={themeStorageKey} />
          </header>
          <main id="app-main">{children}</main>
        </div>
      </div>
      {commands.length > 0 && <CommandPalette commands={commands} open={cmdkOpen} onOpenChange={setCmdkOpen} />}
    </ToastProvider>
  );
}
```

> **Note:** palette open-state is owned by `useCommandK()` inside `AppShell`; the search button (`setCmdkOpen(true)`) and the ⌘K shortcut drive the same state, and `CommandPalette` is fully controlled — no synthetic events.

- [ ] **Step 4: Typecheck** — Run: `npm run typecheck` → exits 0.

- [ ] **Step 5: Commit**

```bash
git add components/ui/ThemeToggle.tsx components/shell/AppShell.tsx public/ui.css
git commit -m "feat: cockpit AppShell (rail + topbar + ⌘K + theme + mobile drawer)"
```

---

### Task 14: Dev-only `/ui` gallery + verification pass

**Files:**
- Create: `app/(dev)/layout.tsx`
- Create: `app/(dev)/ui/page.tsx`

**Interfaces:**
- Consumes: every component built in Tasks 2–13.
- Produces: a dev-only route at `/ui` that renders all primitives in all states for visual + a11y QA. Returns 404 in production.

> **Why a route group, not `app/_ui/`:** folders prefixed with `_` are *private* and excluded from routing — `app/_ui/page.tsx` would 404. A route group `app/(dev)/` is omitted from the URL and acts as a third root layout alongside `(portal)`/`(admin)`; the real `ui` segment under it yields `/ui`.

- [ ] **Step 1: Create `app/(dev)/layout.tsx` (a route-group root layout)**

```tsx
import { notFound } from "next/navigation";

export default function UiLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>GB2G · UI Gallery</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/tokens.css" />
        <link rel="stylesheet" href="/ui.css" />
      </head>
      <body style={{ background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-sans)", margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Create `app/(dev)/ui/page.tsx`** (a client gallery that exercises Toast, Modal, ⌘K, all primitives)

```tsx
"use client";
import * as React from "react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select } from "@/components/ui/Field";
import { Card } from "@/components/ui/Card";
import { Badge, StatusPill } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { Modal, Drawer } from "@/components/ui/Modal";
import { Tabs } from "@/components/ui/Tabs";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Tooltip } from "@/components/ui/Tooltip";
import { CommandPalette, useCommandK } from "@/components/ui/CommandPalette";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-mute)", marginBottom: 14 }}>{title}</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>{children}</div>
    </section>
  );
}

function ToastDemo() {
  const { toast } = useToast();
  return (
    <>
      <Button onClick={() => toast({ message: "Saved.", tone: "sage" })}>Success toast</Button>
      <Button variant="danger" onClick={() => toast({ message: "Teammate removed.", tone: "sage", undo: () => alert("undone") })}>Toast + Undo</Button>
    </>
  );
}

export default function Gallery() {
  const [modal, setModal] = React.useState(false);
  const [drawer, setDrawer] = React.useState(false);
  const [tab, setTab] = React.useState("a");
  const [ck, setCk] = useCommandK();
  return (
    <ToastProvider>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "48px 24px" }}>
        <h1 style={{ fontWeight: 300, letterSpacing: "-.03em", fontSize: 40, marginTop: 0 }}>UI Gallery</h1>

        <Section title="Buttons">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger" icon="trash">Danger</Button>
          <Button loading>Saving…</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" icon="plus">Small</Button>
        </Section>

        <Section title="Fields">
          <div style={{ width: 260 }}><Input label="Email" placeholder="you@company.com" hint="We never share this." /></div>
          <div style={{ width: 260 }}><Input label="With error" defaultValue="bad" error="That doesn't look right." /></div>
          <div style={{ width: 260 }}><Select label="Category" options={[{ value: "q", label: "Question" }, { value: "b", label: "Bug" }]} /></div>
          <div style={{ width: 260 }}><Textarea label="Message" placeholder="Type…" autoGrow /></div>
        </Section>

        <Section title="Badges / Status">
          <Badge tone="sage">Active</Badge><Badge tone="gold">Building</Badge><Badge tone="red">Failed</Badge><Badge tone="blue">In progress</Badge><Badge tone="mute">Idle</Badge>
          <StatusPill kind="ticket" status="open" /><StatusPill kind="contract" status="signed" /><StatusPill kind="lead" status="failed" />
        </Section>

        <Section title="Card / Empty / Skeleton">
          <Card title="Herald" action={<Badge tone="sage">Active</Badge>}>Conversations, 24/7.</Card>
          <div style={{ width: 300 }}><Skeleton variant="stat" /></div>
          <div style={{ width: 300 }}><Card><EmptyState title="You're all caught up" action={<Button icon="sparkle">New request</Button>}>No open tickets.</EmptyState></Card></div>
        </Section>

        <Section title="Overlays / Nav">
          <Button onClick={() => setModal(true)}>Open modal</Button>
          <Button variant="secondary" onClick={() => setDrawer(true)}>Open drawer</Button>
          <Tooltip content="This is a tooltip"><Button variant="ghost">Hover me</Button></Tooltip>
          <Breadcrumbs items={[{ label: "Home", href: "#" }, { label: "Dashboard" }]} />
        </Section>

        <Section title="Tabs"><div style={{ width: "100%" }}><Tabs tabs={[{ id: "a", label: "Overview" }, { id: "b", label: "Activity" }]} active={tab} onChange={setTab} /></div></Section>

        <Section title="Toast (live) — and ⌘K to open the palette"><ToastDemo /></Section>

        <Modal open={modal} onClose={() => setModal(false)} title="Remove teammate?"
          footer={<><Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button><Button variant="danger" onClick={() => setModal(false)}>Remove</Button></>}>
          This removes their access to the portal.
        </Modal>
        <Drawer open={drawer} onClose={() => setDrawer(false)} title="Edit details">Drawer body content.</Drawer>

        <CommandPalette open={ck} onOpenChange={setCk} commands={[
          { id: "dash", label: "Go to Dashboard", icon: "dashboard", run: () => alert("dashboard") },
          { id: "tix", label: "New ticket", icon: "plus", keywords: "support", run: () => alert("ticket") },
        ]} />
      </div>
    </ToastProvider>
  );
}
```

- [ ] **Step 3: Run the dev server and verify visually**

Run: `npm run dev`, open `http://localhost:3000/ui`. Confirm:
- All buttons render ink-forward; hover + the spinner animate; Tab key shows the gold focus ring.
- Inputs show focus + error states; the textarea auto-grows.
- Badges/StatusPills use the right tones; Card/EmptyState/Skeleton render; the skeleton shimmers.
- Modal + Drawer open, trap focus, close on Esc/scrim; Tooltip appears on hover/focus.
- Toast buttons stack toasts bottom-right with the draining bar; Undo fires.
- **⌘K** opens the palette; typing filters; ↑/↓ + Enter run a command; Esc closes.
- Toggle OS reduced-motion (or DevTools emulation) → shimmer/spinner/animations calm down.

- [ ] **Step 4: Typecheck** — Run: `npm run typecheck` → exits 0.

- [ ] **Step 5: Commit**

```bash
git add "app/(dev)/layout.tsx" "app/(dev)/ui/page.tsx"
git commit -m "feat: dev-only /ui component gallery"
```

---

## Self-Review

**Spec coverage** (against `2026-06-26-gb2g-foundation-portal-design.md` §3–§6, §8):
- §3 tokens → Task 1 ✓ (incl. dark + reduced-motion). §4 every primitive → Tasks 2,4–12 ✓; `lib/ui/status.ts` → Task 3 ✓. §5 cockpit shell (rail, utility bar, ⌘K, mobile drawer, theme) → Tasks 12–13 ✓. §6 loading/feedback: Skeleton (Task 7) + Toast/Undo (Task 8) ✓; **`loading.tsx`/`error.tsx`/Suspense + optimistic mutations are deliberately deferred to Plan 2** (they attach to portal routes, which don't exist as rebuilt pages yet). §8 a11y baseline (focus-visible, focus-trap, aria, reduced-motion) → woven through every task ✓. **Not in this plan:** per-page application (§7) and route-level loading/error — that is Plan 2 by design.
- **Token unification of `admin.css`/`portal.css`** (§3) is *staged* here: Task 1 links `tokens.css` into both layouts so the variables exist, but the surface stylesheets are refactored to consume them in their respective page-migration cycles (admin = Cycle 2, portal = Plan 2). This keeps Plan 1 free of visual regressions on live pages.

**Placeholder scan:** no TBD/TODO; every code step contains complete code; commands have expected output. ✓

**Type consistency:** `IconName`/`Icon` (Task 2) consumed unchanged in Tasks 4,7,12,13. `Tone`/`StatusKind`/`statusTone`/`statusLabel` (Task 3) consumed in Task 6. `Command`/`filterCommands` (Task 11) → `PaletteCommand` (Task 12) → `commands` prop (Task 13). `useFocusTrap` (Task 9) consumed in Tasks 9,12. `NavItem`/`NavSection` defined and used within Task 13. `useToast`/`ToastProvider` (Task 8) consumed in Tasks 13–14. ✓

**Adversarial verification (applied):** a 4-critic pass (framework / React-19 / CSS / spec-coverage) reviewed this plan against the bundled Next 16 docs + the codebase; all 17 findings were applied — route-group `/ui` gallery (a `_ui` folder is private/non-routable), React-19 ref-as-prop on Button + Field family, controlled `CommandPalette` + `useCommandK` (no synthetic events), a real `menu` icon, the now-visible toast timer bar, `:focus-visible` gold rings on every interactive element, Tabs arrow-key nav, listbox `aria-activedescendant`, and a skip-to-main link.

## Handoff note for Plan 2 (Portal)
Plan 2 will: rewrite `app/(portal)/layout.tsx` to render `AppShell` (passing nav + user + commands), add `app/(portal)/loading.tsx` + `error.tsx` (using `unstable_retry`), wrap dashboard's slow Herald region in `<Suspense>`, refactor `public/portal/portal.css` onto tokens, and migrate the 5 pages (`dashboard`, `connections`, `tickets`, `account`, `mark`) onto the primitives with optimistic mutations + toasts. The portal layout's runtime auth/DB fetch must move below a Suspense boundary (or into pages) so `loading.tsx` can show — see `node_modules/next/dist/docs/.../loading.md` "layout runtime data" note.
```
