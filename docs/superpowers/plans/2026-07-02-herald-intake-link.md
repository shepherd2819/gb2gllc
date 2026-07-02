# Herald-Only Custom Intake Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One public reusable link (`gb2gllc.com/intake/herald`) that serves a slim Herald-branded intake and, on submit, hands-off auto-creates the client, enables the Herald product, maps the chosen agent name, and sends the WorkOS portal invite.

**Architecture:** A nullable `intake_sessions.intended_product` column carries the product signal from link → session → submission → client. Dedicated static form files (`public/intake-herald.html` + `public/intake-herald-app.js`) reuse the existing intake endpoints (`/api/intake/new`, `GET|PATCH /api/intake/[sessionId]`, `/uploads`, `/submit`) unchanged in shape; the serve route branches on the column. Pure automation decisions live in `lib/intake/herald.ts` (unit-tested); routes stay thin.

**Tech Stack:** Next.js 16.2.6 App Router (route handlers + server components), Supabase (`supabaseAdmin`, service-role, RLS deny-all), WorkOS (`getWorkOS().userManagement.sendInvitation`), Notion SDK, vanilla JS/CSS front-end (no React on public intake — brand rule).

**Spec:** `docs/superpowers/specs/2026-06-04-herald-intake-link-design.md` (approved). The spec says migration `027` — that number is taken; **use `031`** (highest today is `030_proposals.sql`).

## Global Constraints

- **Next.js 16 idioms (verified against `node_modules/next/dist/docs/`):** `params`/`searchParams` are **Promises** — always `await` them. `redirect()` throws `NEXT_REDIRECT` — call it **outside** any `try/catch`, never `return redirect()`. The proxy file is `proxy.ts` (NOT `middleware.ts`) — its matcher does **not** include `/intake`, so **no proxy change is needed or allowed**. Route handlers: `NextResponse.json(...)`, defensive `await req.json().catch(() => ...)`.
- **Do NOT edit `public/intake.html`, `public/intake-app.js`, or `public/intake-platforms.js`.** The generic flow must be byte-for-byte unchanged.
- **Vanilla JS/CSS only** for the public form (no React, no UI libs). Every dynamic value interpolated into `innerHTML` must go through `esc()`.
- **Tests:** `node --import tsx --test --test-concurrency=1 'lib/**/*.test.ts'` (MUST be serial — parallel runs crash). Typecheck: `npm run typecheck`. Test glob only covers `lib/**` — that's why automation logic lives in `lib/intake/herald.ts`.
- Test-file style: `import { test } from "node:test"; import assert from "node:assert/strict";`.
- Email validity regex everywhere: `/\S+@\S+\.\S+/` (matches the generic form's welcome gate).
- Migration style: single-line header comment (`-- 031_… — description`), lowercase SQL, RLS on intake tables already exists (no policy change — column add only).
- The serve route injects globals by string-replacing the literal `</head>` — `intake-herald.html` must contain that literal exactly once.
- Commit after every task (small, conventional commits; end commit messages with the Claude co-author trailer).
- Operator note (NOT a build step): `supabase db push` applies migration 031 before this works in prod.

---

### Task 1: Pure Herald automation helpers (`lib/intake/herald.ts`)

**Files:**
- Create: `lib/intake/herald.ts`
- Test: `lib/intake/herald.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Tasks 7, 8, 9, 10):
  - `HERALD_PRODUCT = "herald"`, `HERALD_SOURCE = "herald-link"` (string consts)
  - `isValidEmail(email: unknown): email is string`
  - `type HeraldAnswers = { website: { url; platform; snippetAccess }, knowledge: { services; faqs; hours; policies }, voice: { agentName; tone; avoid }, leads: { destination; contact; bookingLink } }` (all strings)
  - `heraldAnswers(state: Record<string, unknown>): HeraldAnswers` — safe shaper, missing keys → `""`
  - `type HeraldAutomationPlan = { enableProduct: boolean; setAgentName: string | null; sendInvite: boolean }`
  - `planHeraldAutomation(opts: { intendedProduct: string | null; email: unknown; agentName: string; client: { chatbot_agent_name: string | null; invited_at: string | null } | null }): HeraldAutomationPlan`

- [ ] **Step 1: Write the failing test**

Create `lib/intake/herald.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HERALD_PRODUCT,
  HERALD_SOURCE,
  isValidEmail,
  heraldAnswers,
  planHeraldAutomation,
} from "./herald";

test("constants", () => {
  assert.equal(HERALD_PRODUCT, "herald");
  assert.equal(HERALD_SOURCE, "herald-link");
});

test("isValidEmail accepts plausible emails and rejects junk", () => {
  assert.equal(isValidEmail("jo@acme.com"), true);
  assert.equal(isValidEmail("a@b.co"), true);
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("a@b"), false);
  assert.equal(isValidEmail(null), false);
  assert.equal(isValidEmail(undefined), false);
  assert.equal(isValidEmail(42), false);
});

test("heraldAnswers shapes a full state", () => {
  const state = {
    herald: {
      website: { url: "https://acme.com", platform: "WordPress", snippetAccess: "I can" },
      knowledge: { services: "Plumbing", faqs: "Pricing?", hours: "9-5", policies: "No refunds" },
      voice: { agentName: "Pipes", tone: "Friendly", avoid: "slang" },
      leads: { destination: "Email", contact: "jo@acme.com", bookingLink: "https://cal.com/acme" },
    },
  };
  const a = heraldAnswers(state);
  assert.equal(a.website.url, "https://acme.com");
  assert.equal(a.knowledge.services, "Plumbing");
  assert.equal(a.voice.agentName, "Pipes");
  assert.equal(a.leads.bookingLink, "https://cal.com/acme");
});

test("heraldAnswers tolerates missing/garbage sub-trees", () => {
  assert.equal(heraldAnswers({}).voice.agentName, "");
  assert.equal(heraldAnswers({ herald: null as unknown as Record<string, unknown> }).website.url, "");
  assert.equal(heraldAnswers({ herald: { voice: { agentName: 7 } } }).voice.agentName, "");
});

const freshClient = { chatbot_agent_name: null, invited_at: null };

test("planHeraldAutomation: happy path enables all three", () => {
  const plan = planHeraldAutomation({
    intendedProduct: "herald",
    email: "jo@acme.com",
    agentName: "Pipes",
    client: freshClient,
  });
  assert.deepEqual(plan, { enableProduct: true, setAgentName: "Pipes", sendInvite: true });
});

test("planHeraldAutomation: non-herald session does nothing", () => {
  const plan = planHeraldAutomation({
    intendedProduct: null,
    email: "jo@acme.com",
    agentName: "Pipes",
    client: freshClient,
  });
  assert.deepEqual(plan, { enableProduct: false, setAgentName: null, sendInvite: false });
});

test("planHeraldAutomation: invalid email does nothing", () => {
  const plan = planHeraldAutomation({
    intendedProduct: "herald",
    email: "junk",
    agentName: "Pipes",
    client: freshClient,
  });
  assert.deepEqual(plan, { enableProduct: false, setAgentName: null, sendInvite: false });
});

test("planHeraldAutomation: missing client does nothing", () => {
  const plan = planHeraldAutomation({
    intendedProduct: "herald",
    email: "jo@acme.com",
    agentName: "Pipes",
    client: null,
  });
  assert.deepEqual(plan, { enableProduct: false, setAgentName: null, sendInvite: false });
});

test("planHeraldAutomation: existing agent name is never overwritten", () => {
  const plan = planHeraldAutomation({
    intendedProduct: "herald",
    email: "jo@acme.com",
    agentName: "Pipes",
    client: { chatbot_agent_name: "Existing", invited_at: null },
  });
  assert.equal(plan.setAgentName, null);
  assert.equal(plan.enableProduct, true);
});

test("planHeraldAutomation: already-invited client is not re-invited", () => {
  const plan = planHeraldAutomation({
    intendedProduct: "herald",
    email: "jo@acme.com",
    agentName: "",
    client: { chatbot_agent_name: null, invited_at: "2026-01-01T00:00:00Z" },
  });
  assert.equal(plan.sendInvite, false);
  assert.equal(plan.enableProduct, true);
});

test("planHeraldAutomation: blank/whitespace agent name maps to null", () => {
  const plan = planHeraldAutomation({
    intendedProduct: "herald",
    email: "jo@acme.com",
    agentName: "   ",
    client: freshClient,
  });
  assert.equal(plan.setAgentName, null);
});

test("planHeraldAutomation: agent name is trimmed", () => {
  const plan = planHeraldAutomation({
    intendedProduct: "herald",
    email: "jo@acme.com",
    agentName: "  Pipes  ",
    client: freshClient,
  });
  assert.equal(plan.setAgentName, "Pipes");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test --test-concurrency=1 lib/intake/herald.test.ts`
Expected: FAIL — cannot find module `./herald`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/intake/herald.ts`:

```ts
// Herald-only intake link: pure decision helpers shared by the submit route,
// the admin convert route, the Notion serializer, and the admin submission UI.

export const HERALD_PRODUCT = "herald";
export const HERALD_SOURCE = "herald-link";

// Same permissive regex the intake forms use client-side.
export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && /\S+@\S+\.\S+/.test(email);
}

export type HeraldAnswers = {
  website: { url: string; platform: string; snippetAccess: string };
  knowledge: { services: string; faqs: string; hours: string; policies: string };
  voice: { agentName: string; tone: string; avoid: string };
  leads: { destination: string; contact: string; bookingLink: string };
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function heraldAnswers(state: Rec): HeraldAnswers {
  const h = rec(state.herald);
  const w = rec(h.website);
  const k = rec(h.knowledge);
  const v = rec(h.voice);
  const l = rec(h.leads);
  return {
    website: { url: str(w.url), platform: str(w.platform), snippetAccess: str(w.snippetAccess) },
    knowledge: { services: str(k.services), faqs: str(k.faqs), hours: str(k.hours), policies: str(k.policies) },
    voice: { agentName: str(v.agentName), tone: str(v.tone), avoid: str(v.avoid) },
    leads: { destination: str(l.destination), contact: str(l.contact), bookingLink: str(l.bookingLink) },
  };
}

export type HeraldAutomationPlan = {
  enableProduct: boolean;
  setAgentName: string | null;
  sendInvite: boolean;
};

export function planHeraldAutomation(opts: {
  intendedProduct: string | null;
  email: unknown;
  agentName: string;
  client: { chatbot_agent_name: string | null; invited_at: string | null } | null;
}): HeraldAutomationPlan {
  const off: HeraldAutomationPlan = { enableProduct: false, setAgentName: null, sendInvite: false };
  if (opts.intendedProduct !== HERALD_PRODUCT) return off;
  if (!isValidEmail(opts.email)) return off;
  if (!opts.client) return off;
  const name = opts.agentName.trim();
  return {
    enableProduct: true,
    setAgentName: name && !opts.client.chatbot_agent_name ? name : null,
    sendInvite: !opts.client.invited_at,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test --test-concurrency=1 lib/intake/herald.test.ts`
Expected: PASS (11 tests). Also run `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add lib/intake/herald.ts lib/intake/herald.test.ts
git commit -m "feat(intake): pure Herald-link automation helpers + tests"
```

---

### Task 2: Migration 031 + `POST /api/intake/new` accepts `intendedProduct`

**Files:**
- Create: `supabase/migrations/031_intake_intended_product.sql`
- Modify: `app/api/intake/new/route.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `intake_sessions.intended_product` (nullable TEXT) column; `POST /api/intake/new` body gains optional `intendedProduct` — only the literal `"herald"` is persisted (public endpoint: whitelist, never pass through arbitrary text). Response shape unchanged: `{ sessionId, createdAt, resumeUrl }`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/031_intake_intended_product.sql`:

```sql
-- 031_intake_intended_product.sql — product-scoped intake links (Herald v1)
alter table intake_sessions
  add column if not exists intended_product text;

comment on column intake_sessions.intended_product is
  'Product this intake link is scoped to (e.g. "herald"); drives the tailored form + auto product-enable on submit. NULL = generic intake.';
```

No CHECK constraint (kept open for future product links; values written only by server code that whitelists). RLS inherited from existing `intake_sessions` policies — no policy change.

- [ ] **Step 2: Modify the new-session route**

Replace `app/api/intake/new/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { randomUUID } from "crypto";
import { HERALD_PRODUCT } from "@/lib/intake/herald";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const source: string = body.source ?? "web";
    const prefill: Record<string, unknown> = body.prefill ?? {};
    // Public endpoint: whitelist, never persist arbitrary text.
    const intendedProduct: string | null =
      body.intendedProduct === HERALD_PRODUCT ? HERALD_PRODUCT : null;

    const sessionId = `sess_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

    const initialState = prefill && Object.keys(prefill).length > 0
      ? { contact: prefill }
      : {};

    const { error } = await supabaseAdmin.from("intake_sessions").insert({
      id: sessionId,
      source,
      state: initialState,
      intended_product: intendedProduct,
    });

    if (error) throw error;

    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://gb2gllc.com";

    return NextResponse.json({
      sessionId,
      createdAt: new Date().toISOString(),
      resumeUrl: `${base}/intake/${sessionId}`,
    });
  } catch (err) {
    console.error("intake/new error:", err);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — clean.
Run: `node --import tsx --test --test-concurrency=1 'lib/**/*.test.ts'` — all pass (no regressions).
Note: the migration cannot be applied from this environment; `supabase db push` is an operator step. Inserting `intended_product` before push would fail at runtime in prod — acceptable on this unpushed branch; flag it in the final report.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/031_intake_intended_product.sql app/api/intake/new/route.ts
git commit -m "feat(intake): intended_product column + whitelisted intendedProduct on session mint"
```

---

### Task 3: Public entry page `app/intake/herald/page.tsx`

**Files:**
- Create: `app/intake/herald/page.tsx`

**Interfaces:**
- Consumes: `POST /api/intake/new` (Task 2) with `{ source: "herald-link", intendedProduct: "herald" }`.
- Produces: public URL `gb2gllc.com/intake/herald` → redirects to `/intake/{sessionId}`. No proxy change needed (`/intake` is not in `proxy.ts` matcher — leave it that way).

- [ ] **Step 1: Write the page**

Mirror the existing `app/intake/page.tsx` idiom exactly (it is live and proven; note `redirect()` stays outside any try/catch per Next 16 docs). Create `app/intake/herald/page.tsx`:

```tsx
import { redirect } from "next/navigation";

// Reusable public link for Herald-only signups: mints a Herald-tagged
// intake session and redirects to the session URL.
export default async function HeraldIntakePage() {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  const res = await fetch(`${base}/api/intake/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "herald-link", intendedProduct: "herald" }),
    cache: "no-store",
  });

  if (!res.ok) {
    return (
      <html lang="en">
        <body style={{ fontFamily: "sans-serif", padding: 40 }}>
          <p>Something went wrong starting your intake. Please try again.</p>
          <a href="/">← Back to home</a>
        </body>
      </html>
    );
  }

  const { sessionId } = await res.json();
  redirect(`/intake/${sessionId}`);
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — clean.

- [ ] **Step 3: Commit**

```bash
git add app/intake/herald/page.tsx
git commit -m "feat(intake): public /intake/herald entry page (mints herald-tagged session)"
```

---

### Task 4: Herald form shell `public/intake-herald.html`

**Files:**
- Create: `public/intake-herald.html`

**Interfaces:**
- Consumes: brand tokens/classes from the generic intake (copied, not shared — the generic files must not change).
- Produces: the HTML shell Task 6's serve route reads from disk. MUST contain the literal `</head>` exactly once (the serve route string-replaces it to inject `window.GB2G_SESSION_ID`, `window.GB2G_CALENDLY_URL`, `window.GB2G_INTAKE_MODE`). Loads `/intake-herald-app.js` (Task 5) via the search-param-preserving loader. Element IDs the app depends on: `#progress`, `#main`, `#save-status`, `#theme-toggle`.

- [ ] **Step 1: Write the file**

Create `public/intake-herald.html` (complete file):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GB2GLLC — Herald Setup</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="theme-color" content="#1C1E1B" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
  <style>
    :root {
      --abs-dark: #1C1E1B;  --abs-light: #FAF6EC;
      --parchment: #F4EEE2; --parchment-2: #FAF6EC; --parchment-3: #EDE3CC;
      --ink: #1C1E1B; --ink-soft: #4A4D47; --ink-mute: #8A8C85;
      --rule: #E4DDCC; --rule-soft: #EDE7D7;
      --dusty-blue: #7F9DB9; --dusty-blue-deep: #4E6E8C;
      --warm-gold: #C9A961; --warm-gold-deep: #9B7E3F;
      --sage: #A6B49B; --terracotta: #C97B5C; --burgundy: #82403C;
      --sans: "Geist", ui-sans-serif, system-ui, sans-serif;
      --mono: "Geist Mono", ui-monospace, monospace;
      --serif: "Instrument Serif", "Iowan Old Style", Georgia, serif;
    }
    [data-theme="dark"] {
      --parchment: #232522; --parchment-2: #1C1E1B; --parchment-3: #2C2E2A;
      --ink: #FAF6EC; --ink-soft: #C9CBc4; --ink-mute: #8A8C85;
      --rule: #3A3C37; --rule-soft: #2E302B;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      font-family: var(--sans); background: var(--parchment); color: var(--ink);
      min-height: 100vh; -webkit-font-smoothing: antialiased;
    }
    header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 28px; border-bottom: 1px solid var(--rule);
      position: sticky; top: 0; background: var(--parchment); z-index: 10;
    }
    .mark { font-family: var(--mono); font-size: 15px; font-weight: 500; letter-spacing: -0.02em; }
    .mark .two { color: var(--warm-gold-deep); }
    .mark .llc { font-size: 9px; color: var(--ink-mute); margin-left: 3px; letter-spacing: 0.1em; }
    .progress { display: flex; gap: 8px; align-items: center; }
    .stage-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--rule); border: none; padding: 0; cursor: default;
      transition: background 0.3s, transform 0.3s;
    }
    .stage-dot.done { background: var(--dusty-blue-deep); cursor: pointer; }
    .stage-dot.current { background: var(--warm-gold); transform: scale(1.35); }
    .head-right { display: flex; align-items: center; gap: 14px; }
    .theme-toggle {
      background: none; border: 1px solid var(--rule); border-radius: 100px;
      width: 30px; height: 30px; cursor: pointer; color: var(--ink-soft);
      font-size: 13px; line-height: 1;
    }
    .save-state { display: flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11px; color: var(--ink-mute); }
    .save-state .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--sage); animation: pulse 2.4s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
    main { max-width: 680px; margin: 0 auto; padding: 56px 28px 96px; }
    .stage-wrap { animation: stage-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }
    @keyframes stage-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    .eyebrow {
      font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em;
      text-transform: uppercase; color: var(--warm-gold-deep); margin-bottom: 14px;
    }
    h1 { font-family: var(--serif); font-size: 42px; font-weight: 400; line-height: 1.12; letter-spacing: -0.01em; margin-bottom: 16px; }
    .lede { font-size: 16px; line-height: 1.65; color: var(--ink-soft); margin-bottom: 36px; max-width: 56ch; }
    .field { margin-bottom: 22px; }
    .field label {
      display: block; font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--ink-soft); margin-bottom: 8px;
    }
    .req { color: var(--terracotta); }
    .hint { font-size: 12.5px; color: var(--ink-mute); margin-top: 6px; line-height: 1.5; }
    .field input[type="text"], .field input[type="email"], .field input[type="url"], .field textarea {
      width: 100%; font-family: var(--sans); font-size: 15px; color: var(--ink);
      background: var(--parchment-2); border: 1px solid var(--rule); border-radius: 10px;
      padding: 12px 14px; outline: none; transition: border-color 0.2s;
    }
    .field input:focus, .field textarea:focus { border-color: var(--dusty-blue); }
    .field textarea { min-height: 96px; resize: vertical; line-height: 1.55; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .pill-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .pill {
      font-family: var(--sans); font-size: 13.5px; color: var(--ink-soft);
      background: var(--parchment-2); border: 1px solid var(--rule); border-radius: 100px;
      padding: 8px 16px; cursor: pointer; transition: all 0.18s;
    }
    .pill:hover { border-color: var(--ink-mute); }
    .pill.selected { background: var(--ink); color: var(--abs-light); border-color: var(--ink); }
    [data-theme="dark"] .pill.selected { background: var(--abs-light); color: var(--abs-dark); border-color: var(--abs-light); }
    .actions { display: flex; align-items: center; justify-content: space-between; margin-top: 40px; }
    .btn {
      font-family: var(--sans); font-size: 14px; font-weight: 500; border-radius: 100px;
      padding: 12px 26px; cursor: pointer; border: 1px solid transparent; transition: all 0.2s;
    }
    .btn .arrow { display: inline-block; transition: transform 0.2s; }
    .btn:hover .arrow { transform: translateX(3px); }
    .btn-primary { background: var(--ink); color: var(--abs-light); }
    .btn-primary:hover { background: var(--dusty-blue-deep); }
    .btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }
    .btn-primary:disabled .arrow { transform: none; }
    [data-theme="dark"] .btn-primary { background: var(--abs-light); color: var(--abs-dark); }
    [data-theme="dark"] .btn-primary:hover { background: var(--dusty-blue); }
    .btn-ghost { background: none; border-color: var(--rule); color: var(--ink-soft); }
    .btn-ghost:hover { border-color: var(--ink-mute); }
    .btn-back { background: none; color: var(--ink-mute); padding-left: 0; }
    .btn-back .arrow { transform: scaleX(-1); margin-right: 4px; }
    .btn-back:hover { color: var(--ink); }
    .btn-back:hover .arrow { transform: scaleX(-1) translateX(3px); }
    .drop {
      border: 1.5px dashed var(--rule); border-radius: 14px; background: var(--parchment-2);
      padding: 32px 24px; text-align: center; margin-bottom: 18px; transition: border-color 0.2s;
    }
    .drop.over { border-color: var(--dusty-blue); }
    .drop p { font-size: 14px; margin-bottom: 6px; }
    .drop .hint { margin-bottom: 14px; }
    .file-row {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      background: var(--parchment-2); border: 1px solid var(--rule); border-radius: 10px;
      padding: 10px 14px; margin-bottom: 8px; font-size: 13.5px;
    }
    .file-row .meta { font-family: var(--mono); font-size: 11px; color: var(--ink-mute); }
    .calendly-inline-widget { border: 1px solid var(--rule); border-radius: 14px; overflow: hidden; }
    .done-hero { text-align: center; padding-top: 12px; }
    .done-icon {
      width: 64px; height: 64px; border-radius: 50%; background: var(--sage);
      color: var(--abs-light); font-size: 28px; line-height: 64px; margin: 0 auto 24px;
      position: relative; animation: ripple 1.8s ease-out 1;
    }
    @keyframes ripple {
      0% { box-shadow: 0 0 0 0 rgba(166, 180, 155, 0.5); }
      100% { box-shadow: 0 0 0 26px rgba(166, 180, 155, 0); }
    }
    .summary {
      text-align: left; background: var(--parchment-2); border: 1px solid var(--rule);
      border-radius: 14px; padding: 22px 24px; margin: 32px 0;
    }
    .summary-row { display: grid; grid-template-columns: 160px 1fr; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--rule-soft); font-size: 14px; }
    .summary-row:last-child { border-bottom: none; }
    .summary-row .key { font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-mute); padding-top: 2px; }
    .verse-closer {
      background: var(--ink); color: var(--abs-light); border-radius: 14px;
      font-family: var(--serif); font-style: italic; font-size: 16px; line-height: 1.6;
      padding: 24px 28px; margin-top: 36px; text-align: center;
    }
    .verse-closer .ref { display: block; font-family: var(--mono); font-style: normal; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--warm-gold); margin-top: 10px; }
    footer.done-foot { text-align: center; margin-top: 28px; font-size: 13px; }
    footer.done-foot a { color: var(--dusty-blue-deep); }
    @media (prefers-reduced-motion: reduce) {
      .stage-wrap, .done-icon, .save-state .dot { animation: none !important; }
      .btn .arrow, .stage-dot { transition: none !important; }
    }
    @media (max-width: 700px) {
      .form-row { grid-template-columns: 1fr; }
      h1 { font-size: 32px; }
      main { padding: 36px 20px 72px; }
      header .progress { display: none; }
      .summary-row { grid-template-columns: 1fr; gap: 2px; }
    }
  </style>
  <script>
    (function () {
      try {
        var t = localStorage.getItem('gb2g_theme');
        if (!t) t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      } catch (e) {}
    })();
  </script>
</head>
<body>
  <header>
    <div class="mark">gb<span class="two">2</span>g<span class="llc">LLC</span></div>
    <div class="progress" id="progress"></div>
    <div class="head-right">
      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme">◐</button>
      <div class="save-state"><span class="dot"></span><span id="save-status">Auto-saved</span></div>
    </div>
  </header>

  <main id="main"></main>

  <script>
    (function () {
      const params = window.location.search || '';
      const s = document.createElement('script');
      s.src = '/intake-herald-app.js' + params;
      s.onerror = function () {
        document.getElementById('main').innerHTML =
          '<div style="padding:24px;color:#82403C;">Script load failed — please refresh.</div>';
      };
      document.head.appendChild(s);
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify**

Run: `grep -c "</head>" public/intake-herald.html`
Expected: `1` (exactly one literal — required by the serve-route injection).
Run: `grep -c "intake-herald-app.js" public/intake-herald.html` → `1`.

- [ ] **Step 3: Commit**

```bash
git add public/intake-herald.html
git commit -m "feat(intake): Herald-branded intake shell (brand tokens, single-column)"
```

---

### Task 5: Herald form app `public/intake-herald-app.js`

**Files:**
- Create: `public/intake-herald-app.js`

**Interfaces:**
- Consumes: `window.GB2G_SESSION_ID`, `window.GB2G_CALENDLY_URL`, DOM IDs from Task 4 (`#progress`, `#main`, `#save-status`, `#theme-toggle`). Server contracts (all existing, unchanged):
  - `GET /api/intake/{id}` → `{ sessionId, state, submittedAt }`
  - `PATCH /api/intake/{id}` body = whole state JSON (server does shallow top-level merge) → `{ ok, savedAt }`
  - `POST /api/intake/{id}/uploads` body `{ name, contentType, size }` → `{ fileId, uploadUrl }`, then `PUT uploadUrl` with raw file + `Content-Type` header (25MB cap; pdf/doc/docx/txt/md/rtf only)
  - `POST /api/intake/{id}/submit` (no body)
- Produces: the `state` shape Tasks 7/8/10 read: `state.contact = { name, email, company }`, `state.herald = { website: { url, platform, snippetAccess }, knowledge: { services, faqs, hours, policies }, voice: { agentName, tone, avoid }, leads: { destination, contact, bookingLink } }`, `state.sops = { files, pastedText, additionalLinks }`, `state.schedule = { slot }` — matching `heraldAnswers()` in `lib/intake/herald.ts` (Task 1) exactly.

- [ ] **Step 1: Write the file**

Create `public/intake-herald-app.js` (complete file):

```js
// GB2G Herald-only intake — slim sibling of intake-app.js.
// Reuses the same server endpoints; renders a fixed 8-stage sequence.
const SESSION_ID = window.GB2G_SESSION_ID || null;
const STORAGE_KEY = SESSION_ID ? `gb2g_intake_${SESSION_ID}` : 'gb2g_intake_herald_v1';

const DEFAULT_STATE = {
  stage: 0,
  startedAt: null,
  contact: { name: '', email: '', company: '' },
  herald: {
    website: { url: '', platform: '', snippetAccess: '' },
    knowledge: { services: '', faqs: '', hours: '', policies: '' },
    voice: { agentName: '', tone: '', avoid: '' },
    leads: { destination: '', contact: '', bookingLink: '' },
  },
  sops: { files: [], pastedText: '', additionalLinks: '' },
  schedule: { slot: null },
  doneAt: null,
};
let state = structuredClone(DEFAULT_STATE);

const STAGES = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'website', label: 'Your website' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'voice', label: 'Voice & name' },
  { id: 'leads', label: 'Leads' },
  { id: 'docs', label: 'Docs' },
  { id: 'schedule', label: 'Kickoff call' },
  { id: 'done', label: 'Done' },
];

// ─── helpers ────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function humanSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

// ─── persistence (same contract as intake-app.js) ───────────────────────
let _saveTimer = null;
let _saveInflight = false;

function saveStateLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  const status = document.getElementById('save-status');
  if (status) status.textContent = 'Auto-saved';
}

function saveState() {
  saveStateLocal();
  if (!SESSION_ID) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    if (_saveInflight) return;
    _saveInflight = true;
    const status = document.getElementById('save-status');
    if (status) status.textContent = 'Saving…';
    try {
      const res = await fetch(`/api/intake/${SESSION_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
      if (res.ok && status) status.textContent = 'Saved';
    } catch (e) {
      if (status) status.textContent = 'Auto-saved (offline)';
    } finally {
      _saveInflight = false;
    }
  }, 800);
}

async function initState() {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) state = { ...structuredClone(DEFAULT_STATE), ...JSON.parse(cached) };
  } catch (e) {}
  if (!state.startedAt) state.startedAt = Date.now();
  render();
  if (!SESSION_ID) return;
  try {
    const res = await fetch(`/api/intake/${SESSION_ID}`);
    if (res.ok) {
      const { state: remoteState } = await res.json();
      if (remoteState && typeof remoteState === 'object' && Object.keys(remoteState).length > 0) {
        state = { ...structuredClone(DEFAULT_STATE), ...remoteState };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
        render();
      }
    }
  } catch (e) {}
}

// ─── navigation ──────────────────────────────────────────────────────────
function canAdvance() {
  const id = STAGES[state.stage].id;
  switch (id) {
    case 'welcome':
      return !!(state.contact.name.trim() && state.contact.company.trim()
        && /\S+@\S+\.\S+/.test(state.contact.email));
    case 'website': return !!state.herald.website.url.trim();
    case 'knowledge': return !!state.herald.knowledge.services.trim();
    case 'voice': return !!state.herald.voice.agentName.trim();
    case 'leads': return !!state.herald.leads.destination;
    default: return true;
  }
}

function goTo(idx) {
  if (idx < 0 || idx >= STAGES.length || idx === state.stage) return;
  state.stage = idx;
  saveState();
  render();
}
function next() { if (state.stage < STAGES.length - 1) goTo(state.stage + 1); }
function prev() { if (state.stage > 0) goTo(state.stage - 1); }

// ─── chrome ──────────────────────────────────────────────────────────────
function renderProgress() {
  const wrap = document.getElementById('progress');
  if (!wrap) return;
  wrap.innerHTML = '';
  STAGES.forEach((s, i) => {
    const dot = document.createElement('button');
    dot.className = 'stage-dot' + (i < state.stage ? ' done' : i === state.stage ? ' current' : '');
    dot.title = s.label;
    if (i < state.stage) dot.addEventListener('click', () => goTo(i));
    wrap.appendChild(dot);
  });
}

function actionsHtml(opts = {}) {
  const primary = opts.primaryLabel || 'Continue';
  const isFirst = state.stage === 0;
  return `<div class="actions">
    ${isFirst ? '<span></span>' : '<button class="btn btn-back" id="btn-back"><span class="arrow">→</span> Back</button>'}
    <button class="btn btn-primary" id="btn-next" ${canAdvance() ? '' : 'disabled'}>${esc(primary)} <span class="arrow">→</span></button>
  </div>`;
}

function wireActions(node) {
  const back = node.querySelector('#btn-back');
  if (back) back.addEventListener('click', prev);
  const nxt = node.querySelector('#btn-next');
  if (nxt) nxt.addEventListener('click', () => { if (canAdvance()) next(); });
}

function refreshNext(node) {
  const b = node.querySelector('#btn-next');
  if (b) b.disabled = !canAdvance();
}

function bindText(node, sel, get, set) {
  const input = node.querySelector(sel);
  if (!input) return;
  input.value = get();
  input.addEventListener('input', () => {
    set(input.value);
    saveStateLocal();
    refreshNext(node);
  });
  input.addEventListener('change', () => saveState());
}

function bindPills(node, rowSel, current, onPick) {
  node.querySelectorAll(`${rowSel} .pill`).forEach((p) => {
    if (p.dataset.value === current()) p.classList.add('selected');
    p.addEventListener('click', () => {
      onPick(p.dataset.value);
      node.querySelectorAll(`${rowSel} .pill`).forEach((q) =>
        q.classList.toggle('selected', q.dataset.value === p.dataset.value));
      saveState();
      refreshNext(node);
    });
  });
}

// ─── stages ──────────────────────────────────────────────────────────────
function renderWelcome() {
  const node = el(`<div class="stage-wrap">
    <p class="eyebrow">Herald setup</p>
    <h1>Let&rsquo;s stand up your website assistant.</h1>
    <p class="lede">Herald answers your visitors&rsquo; questions, captures leads, and hands the tricky stuff to a human. A few quick questions and we&rsquo;ll have everything we need — about five minutes.</p>
    <div class="form-row">
      <div class="field"><label>Your name <span class="req">*</span></label><input id="f-name" type="text" autocomplete="name" /></div>
      <div class="field"><label>Company <span class="req">*</span></label><input id="f-company" type="text" autocomplete="organization" /></div>
    </div>
    <div class="field">
      <label>Email <span class="req">*</span></label>
      <input id="f-email" type="email" autocomplete="email" />
      <p class="hint">We&rsquo;ll send your GB2G portal invite here when you finish.</p>
    </div>
    ${actionsHtml({ primaryLabel: "Let's go" })}
  </div>`);
  bindText(node, '#f-name', () => state.contact.name, (v) => { state.contact.name = v; });
  bindText(node, '#f-company', () => state.contact.company, (v) => { state.contact.company = v; });
  bindText(node, '#f-email', () => state.contact.email, (v) => { state.contact.email = v; });
  wireActions(node);
  return node;
}

function renderWebsite() {
  const node = el(`<div class="stage-wrap">
    <p class="eyebrow">Your website</p>
    <h1>Where will Herald live?</h1>
    <p class="lede">Herald sits on your site as a chat widget — one small code snippet and it&rsquo;s live.</p>
    <div class="field"><label>Website URL <span class="req">*</span></label><input id="f-url" type="url" placeholder="https://" autocomplete="url" /></div>
    <div class="field">
      <label>Platform</label>
      <div class="pill-row" id="row-platform">
        ${['Squarespace', 'WordPress', 'Shopify', 'Wix', 'Custom', 'Other'].map((p) =>
          `<button type="button" class="pill" data-value="${p}">${p}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Who can add a code snippet to the site?</label>
      <div class="pill-row" id="row-snippet">
        ${['I can', 'My web person can', 'Not sure'].map((p) =>
          `<button type="button" class="pill" data-value="${p}">${p}</button>`).join('')}
      </div>
      <p class="hint">Not sure is fine — we&rsquo;ll walk you through it on the kickoff call.</p>
    </div>
    ${actionsHtml()}
  </div>`);
  bindText(node, '#f-url', () => state.herald.website.url, (v) => { state.herald.website.url = v; });
  bindPills(node, '#row-platform', () => state.herald.website.platform, (v) => { state.herald.website.platform = v; });
  bindPills(node, '#row-snippet', () => state.herald.website.snippetAccess, (v) => { state.herald.website.snippetAccess = v; });
  wireActions(node);
  return node;
}

function renderKnowledge() {
  const node = el(`<div class="stage-wrap">
    <p class="eyebrow">Knowledge</p>
    <h1>What should your assistant know?</h1>
    <p class="lede">Plain language is perfect — bullet points, quick notes, whatever you&rsquo;d tell a new hire on day one.</p>
    <div class="field"><label>Products &amp; services <span class="req">*</span></label><textarea id="f-services" placeholder="What do you sell or do? Rough pricing if you share it publicly."></textarea></div>
    <div class="field"><label>Top questions customers ask</label><textarea id="f-faqs" placeholder="The 3–10 questions you answer over and over."></textarea></div>
    <div class="field"><label>Hours &amp; location</label><textarea id="f-hours" placeholder="Business hours, service area, address if relevant."></textarea></div>
    <div class="field"><label>Key policies</label><textarea id="f-policies" placeholder="Returns, cancellations, guarantees — anything Herald should get exactly right."></textarea></div>
    ${actionsHtml()}
  </div>`);
  bindText(node, '#f-services', () => state.herald.knowledge.services, (v) => { state.herald.knowledge.services = v; });
  bindText(node, '#f-faqs', () => state.herald.knowledge.faqs, (v) => { state.herald.knowledge.faqs = v; });
  bindText(node, '#f-hours', () => state.herald.knowledge.hours, (v) => { state.herald.knowledge.hours = v; });
  bindText(node, '#f-policies', () => state.herald.knowledge.policies, (v) => { state.herald.knowledge.policies = v; });
  wireActions(node);
  return node;
}

function renderVoice() {
  const node = el(`<div class="stage-wrap">
    <p class="eyebrow">Voice &amp; name</p>
    <h1>Give it a name and a voice.</h1>
    <p class="lede">This is what your visitors see in the chat window — make it yours.</p>
    <div class="field">
      <label>Assistant name <span class="req">*</span></label>
      <input id="f-agent-name" type="text" placeholder="e.g. Sunny, Scout, or just Herald" />
      <p class="hint">Shows up in the chat header and your dashboard.</p>
    </div>
    <div class="field">
      <label>Tone</label>
      <div class="pill-row" id="row-tone">
        ${['Friendly', 'Professional', 'Playful'].map((p) =>
          `<button type="button" class="pill" data-value="${p}">${p}</button>`).join('')}
      </div>
    </div>
    <div class="field"><label>Words or topics to avoid</label><textarea id="f-avoid" placeholder="Anything Herald should never say or promise."></textarea></div>
    ${actionsHtml()}
  </div>`);
  bindText(node, '#f-agent-name', () => state.herald.voice.agentName, (v) => { state.herald.voice.agentName = v; });
  bindPills(node, '#row-tone', () => state.herald.voice.tone, (v) => { state.herald.voice.tone = v; });
  bindText(node, '#f-avoid', () => state.herald.voice.avoid, (v) => { state.herald.voice.avoid = v; });
  wireActions(node);
  return node;
}

function renderLeads() {
  const node = el(`<div class="stage-wrap">
    <p class="eyebrow">Leads &amp; escalation</p>
    <h1>Where should the hot leads go?</h1>
    <p class="lede">When Herald captures a lead or hits a question it shouldn&rsquo;t answer alone, it hands off to you.</p>
    <div class="field">
      <label>Send leads &amp; escalations to <span class="req">*</span></label>
      <div class="pill-row" id="row-dest">
        ${['Email', 'SMS', 'Slack'].map((p) =>
          `<button type="button" class="pill" data-value="${p}">${p}</button>`).join('')}
      </div>
    </div>
    <div class="field"><label>Who handles them?</label><input id="f-lead-contact" type="text" placeholder="Name, email, or phone for the person on point" /></div>
    <div class="field">
      <label>Booking link to offer visitors</label>
      <input id="f-booking" type="url" placeholder="https:// (Calendly, Acuity — optional)" />
      <p class="hint">If set, Herald can offer visitors a time on your calendar.</p>
    </div>
    ${actionsHtml()}
  </div>`);
  bindPills(node, '#row-dest', () => state.herald.leads.destination, (v) => { state.herald.leads.destination = v; });
  bindText(node, '#f-lead-contact', () => state.herald.leads.contact, (v) => { state.herald.leads.contact = v; });
  bindText(node, '#f-booking', () => state.herald.leads.bookingLink, (v) => { state.herald.leads.bookingLink = v; });
  wireActions(node);
  return node;
}

function renderFileList(node) {
  const list = node.querySelector('#file-list');
  if (!list) return;
  list.innerHTML = state.sops.files.map((f) =>
    `<div class="file-row"><span>${esc(f.name)}</span><span class="meta">${humanSize(f.size)}${f.fileId ? ' · uploaded' : ' · uploading…'}</span></div>`
  ).join('');
}

async function handleFiles(node, fileList) {
  for (const file of fileList) {
    if (file.size > 25 * 1024 * 1024) { alert(`${file.name} is over the 25MB limit.`); continue; }
    state.sops.files.push({ name: file.name, size: file.size, type: file.type, addedAt: Date.now(), fileId: null });
    saveStateLocal();
    renderFileList(node);
    if (!SESSION_ID) continue;
    try {
      const res = await fetch(`/api/intake/${SESSION_ID}/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, contentType: file.type, size: file.size }),
      });
      if (!res.ok) { console.error('Upload URL error:', await res.text()); continue; }
      const { fileId, uploadUrl } = await res.json();
      await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      const idx = state.sops.files.findIndex((f) => f.name === file.name && !f.fileId);
      if (idx >= 0) { state.sops.files[idx].fileId = fileId; saveState(); renderFileList(node); }
    } catch (e) { console.error('File upload failed:', e); }
  }
}

function renderDocs() {
  const node = el(`<div class="stage-wrap">
    <p class="eyebrow">Docs</p>
    <h1>Got docs? Hand them over.</h1>
    <p class="lede">FAQ sheets, price lists, policy docs — anything Herald can learn from. All optional.</p>
    <div class="drop" id="drop">
      <input id="file-input" type="file" multiple accept=".pdf,.doc,.docx,.txt,.md,.rtf" hidden />
      <p><strong>Drop files here</strong></p>
      <p class="hint">PDF, Word, or text · up to 25MB each</p>
      <button type="button" class="btn btn-ghost" id="pick-files">Choose files</button>
    </div>
    <div id="file-list"></div>
    <div class="field" style="margin-top:22px"><label>Or paste it in</label><textarea id="f-pasted" placeholder="Paste FAQs, policies, anything useful."></textarea></div>
    <div class="field"><label>Helpful links</label><input id="f-links" type="text" placeholder="Help center, menu, pricing page — comma-separated" /></div>
    ${actionsHtml()}
  </div>`);
  const input = node.querySelector('#file-input');
  node.querySelector('#pick-files').addEventListener('click', () => input.click());
  input.addEventListener('change', () => { handleFiles(node, Array.from(input.files || [])); input.value = ''; });
  const drop = node.querySelector('#drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    handleFiles(node, Array.from(e.dataTransfer?.files || []));
  });
  renderFileList(node);
  bindText(node, '#f-pasted', () => state.sops.pastedText, (v) => { state.sops.pastedText = v; });
  bindText(node, '#f-links', () => state.sops.additionalLinks, (v) => { state.sops.additionalLinks = v; });
  wireActions(node);
  return node;
}

function onCalendlyEvent(e) {
  if (e.data && e.data.event === 'calendly.event_scheduled') {
    const payload = e.data.payload || {};
    state.schedule.slot = payload.event?.start_time
      ? new Date(payload.event.start_time).getTime().toString()
      : Date.now().toString();
    saveState();
    render();
  }
}

function renderSchedule() {
  const calendlyUrl = window.GB2G_CALENDLY_URL || 'https://calendly.com/gb2g/intake-kickoff';
  const booked = state.schedule.slot
    ? `<p class="hint" style="margin-bottom:18px">✓ Booked for ${esc(new Date(parseInt(state.schedule.slot)).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</p>`
    : '';
  const node = el(`<div class="stage-wrap">
    <p class="eyebrow">Kickoff call</p>
    <h1>Grab a kickoff slot.</h1>
    <p class="lede">Twenty minutes with John to confirm the details and set your go-live date. You can also skip and book later.</p>
    ${booked}
    <div class="calendly-inline-widget" data-url="${esc(calendlyUrl)}?hide_gdpr_banner=1&primary_color=C9A961" style="min-width:320px;height:660px;"></div>
    ${actionsHtml({ primaryLabel: state.schedule.slot ? 'Continue' : 'Skip for now' })}
  </div>`);
  if (!document.getElementById('calendly-script')) {
    const s = document.createElement('script');
    s.id = 'calendly-script';
    s.src = 'https://assets.calendly.com/assets/external/widget.js';
    s.async = true;
    document.head.appendChild(s);
  }
  window.removeEventListener('message', onCalendlyEvent);
  window.addEventListener('message', onCalendlyEvent);
  wireActions(node);
  return node;
}

async function submitIntake() {
  if (!SESSION_ID) return;
  try {
    await fetch(`/api/intake/${SESSION_ID}/submit`, { method: 'POST' });
  } catch (e) { console.error('Submit failed:', e); }
}

function renderDone() {
  if (!state.doneAt) {
    state.doneAt = Date.now();
    saveStateLocal();
    submitIntake();
  }
  const h = state.herald;
  const slotLabel = state.schedule.slot
    ? new Date(parseInt(state.schedule.slot)).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Not booked yet';
  const docsCount = state.sops.files.length;
  const node = el(`<div class="stage-wrap done-hero">
    <div class="done-icon">✓</div>
    <p class="eyebrow">All set</p>
    <h1>${esc(h.voice.agentName || 'Herald')} is on the way.</h1>
    <p class="lede" style="margin:0 auto 8px">We&rsquo;ve got everything we need. Watch <strong>${esc(state.contact.email)}</strong> for your GB2G portal invite — your assistant build starts now.</p>
    <div class="summary">
      <div class="summary-row"><span class="key">Assistant</span><span>${esc(h.voice.agentName || '—')}${h.voice.tone ? ' · ' + esc(h.voice.tone) : ''}</span></div>
      <div class="summary-row"><span class="key">Website</span><span>${esc(h.website.url || '—')}</span></div>
      <div class="summary-row"><span class="key">Leads go to</span><span>${esc(h.leads.destination || '—')}${h.leads.contact ? ' · ' + esc(h.leads.contact) : ''}</span></div>
      <div class="summary-row"><span class="key">Docs shared</span><span>${docsCount ? docsCount + ' file' + (docsCount === 1 ? '' : 's') : 'None'}</span></div>
      <div class="summary-row"><span class="key">Kickoff call</span><span>${esc(slotLabel)}</span></div>
    </div>
    <div class="verse-closer">
      &ldquo;Whatever you do, work at it with all your heart, as working for the Lord.&rdquo;
      <span class="ref">Colossians 3:23</span>
    </div>
    <footer class="done-foot"><a href="https://gb2gllc.com">← Back to GB2GLLC</a></footer>
  </div>`);
  return node;
}

// ─── render root ─────────────────────────────────────────────────────────
const RENDERERS = {
  welcome: renderWelcome,
  website: renderWebsite,
  knowledge: renderKnowledge,
  voice: renderVoice,
  leads: renderLeads,
  docs: renderDocs,
  schedule: renderSchedule,
  done: renderDone,
};

function render() {
  renderProgress();
  const main = document.getElementById('main');
  if (!main) return;
  main.innerHTML = '';
  main.appendChild(RENDERERS[STAGES[state.stage].id]());
  window.scrollTo({ top: 0 });
}

// ─── bootstrap ───────────────────────────────────────────────────────────
window.next = next;
window.prev = prev;

const themeToggle = document.getElementById('theme-toggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    if (!dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('gb2g_theme', dark ? 'light' : 'dark'); } catch (e) {}
  });
}

initState();
```

- [ ] **Step 2: Sanity-check the file parses**

Run: `node --check public/intake-herald-app.js`
Expected: no output (parses clean).

- [ ] **Step 3: Commit**

```bash
git add public/intake-herald-app.js
git commit -m "feat(intake): Herald 8-stage form app (autosave/upload/submit via existing endpoints)"
```

---

### Task 6: Serve-route branch (`app/intake/[sessionId]/route.ts`)

**Files:**
- Modify: `app/intake/[sessionId]/route.ts`

**Interfaces:**
- Consumes: `intake_sessions.intended_product` (Task 2), `public/intake-herald.html` (Task 4).
- Produces: a `herald` session serves `intake-herald.html` with `window.GB2G_INTAKE_MODE = "herald"` injected; any other/null value serves `intake.html` exactly as before (regression-safe).

- [ ] **Step 1: Modify the route**

Replace `app/intake/[sessionId]/route.ts` with:

```ts
import { NextRequest } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { supabaseAdmin } from "@/lib/supabase";
import { HERALD_PRODUCT } from "@/lib/intake/herald";

type Params = { params: Promise<{ sessionId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { sessionId } = await params;

  // Validate session exists and is not expired
  const { data, error } = await supabaseAdmin
    .from("intake_sessions")
    .select("id, expires_at, intended_product")
    .eq("id", sessionId)
    .single();

  if (error || !data || new Date(data.expires_at) < new Date()) {
    return new Response(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px">
        <p>This intake link is invalid or has expired.</p>
        <a href="/">← Back to home</a>
      </body></html>`,
      { status: 404, headers: { "Content-Type": "text/html" } }
    );
  }

  const isHerald = data.intended_product === HERALD_PRODUCT;
  let html = readFileSync(
    join(process.cwd(), "public", isHerald ? "intake-herald.html" : "intake.html"),
    "utf-8"
  );

  // Inject session ID and Calendly URL before </head>
  const calendlyUrl = process.env.NEXT_PUBLIC_CALENDLY_URL ?? "";
  html = html.replace(
    "</head>",
    `<script>window.GB2G_SESSION_ID = ${JSON.stringify(sessionId)};window.GB2G_CALENDLY_URL = ${JSON.stringify(calendlyUrl)};${isHerald ? `window.GB2G_INTAKE_MODE = ${JSON.stringify(HERALD_PRODUCT)};` : ""}</script>\n</head>`
  );

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — clean.

- [ ] **Step 3: Commit**

```bash
git add "app/intake/[sessionId]/route.ts"
git commit -m "feat(intake): serve Herald shell + GB2G_INTAKE_MODE for herald-tagged sessions"
```

---

### Task 7: Hands-off Herald automation in the submit route

**Files:**
- Modify: `app/api/intake/[sessionId]/submit/route.ts`

**Interfaces:**
- Consumes: `HERALD_PRODUCT`, `isValidEmail`, `heraldAnswers`, `planHeraldAutomation` from `lib/intake/herald` (Task 1); `intake_sessions.intended_product` (Task 2); `getWorkOS().userManagement.sendInvitation({ email })` (established repo idiom); `logEvent` from `lib/logger` (category `"intake"` exists in the union).
- Produces: response gains `{ clientId, heraldEnabled, invited }`. Generic sessions behave exactly as before (all three are `null`/`false`). The Herald block is gated on valid email, NOT on Notion success (spec §Finish loop). Idempotency: `submitted_at` early-return (existing), `client_products` UNIQUE upsert, invite only when `invited_at` is null, `invited_at` set only on success.

- [ ] **Step 1: Modify the route**

Replace `app/api/intake/[sessionId]/submit/route.ts` with:

```ts
import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createIntakePage } from "@/lib/notion";
import { resend, DEFAULT_FROM } from "@/lib/resend";
import { logEvent } from "@/lib/logger";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { HERALD_PRODUCT, heraldAnswers, isValidEmail, planHeraldAutomation } from "@/lib/intake/herald";

type Params = { params: Promise<{ sessionId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { sessionId } = await params;

  const { data: session, error: sessionErr } = await supabaseAdmin
    .from("intake_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (sessionErr || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.submitted_at) {
    // Idempotent — already submitted
    return NextResponse.json({ ok: true, notionPageId: session.notion_page_id, alreadySubmitted: true });
  }

  const state = session.state as Record<string, unknown>;

  // Fetch uploaded files for this session
  const { data: files } = await supabaseAdmin
    .from("intake_files")
    .select("name, size, storage_path")
    .eq("session_id", sessionId);

  // Create Notion page
  let notionPageId: string | null = null;
  let notionError: string | null = null;
  try {
    notionPageId = await createIntakePage(sessionId, state, files ?? []);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Notion page creation failed:", msg);
    notionError = msg;
  }

  // Mark submitted in DB
  await supabaseAdmin
    .from("intake_sessions")
    .update({
      submitted_at: new Date().toISOString(),
      notion_page_id: notionPageId,
    })
    .eq("id", sessionId);

  // Auto-create client portal account from intake contact info
  const contact = (state as Record<string, Record<string, string>>).contact ?? {};
  if (notionPageId && contact.email) {
    await supabaseAdmin.from("clients").upsert(
      {
        intake_session_id: sessionId,
        name: contact.name || null,
        email: contact.email,
        company: contact.company || null,
      },
      { onConflict: "email", ignoreDuplicates: true }
    );
  }

  // Welcome / acknowledgement email (best-effort; previously missing).
  if (contact.email) {
    after(async () => {
      try {
        const name = contact.name || "there";
        const nameHtml = name.replace(/[&<>"']/g, (c) =>
          ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
        );
        await resend().emails.send({
          from: DEFAULT_FROM,
          to: contact.email,
          subject: "We got your intake — welcome to GB2G",
          html: `<p>Hi ${nameHtml},</p><p>Thanks for sharing your details with GB2G. We've received everything and our team is reviewing it now — we'll be in touch shortly with your next steps.</p><p>— The GB2G team</p>`,
          text: `Hi ${name},\n\nThanks for sharing your details with GB2G. We've received everything and our team is reviewing it now — we'll be in touch shortly with your next steps.\n\n— The GB2G team`,
        });
      } catch (err) {
        console.error("[intake/submit] welcome email failed:", err instanceof Error ? err.message : err);
      }
    });
  }

  // Herald-link hands-off automation: enable product, map agent name, guarded
  // portal invite. Gated on a valid email — NOT on Notion success (spec).
  let clientId: string | null = null;
  let heraldEnabled = false;
  let invited = false;

  if (session.intended_product === HERALD_PRODUCT && isValidEmail(contact.email)) {
    const email = contact.email;

    // Resolve the client id — the upsert above may have been skipped (Notion
    // failure) or hit a duplicate (ignoreDuplicates returns 0 rows). Same
    // pattern as convert/route.ts.
    const { data: inserted } = await supabaseAdmin
      .from("clients")
      .upsert(
        {
          intake_session_id: sessionId,
          name: contact.name || null,
          email,
          company: contact.company || null,
        },
        { onConflict: "email", ignoreDuplicates: true }
      )
      .select("id");
    clientId = inserted?.[0]?.id ?? null;
    if (!clientId) {
      const { data: existing } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("email", email)
        .single();
      clientId = existing?.id ?? null;
    }

    if (clientId) {
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("chatbot_agent_name, invited_at")
        .eq("id", clientId)
        .single();

      const plan = planHeraldAutomation({
        intendedProduct: session.intended_product,
        email,
        agentName: heraldAnswers(state).voice.agentName,
        client: client ?? null,
      });

      if (plan.enableProduct) {
        const { error: prodErr } = await supabaseAdmin
          .from("client_products")
          .upsert(
            { client_id: clientId, product: HERALD_PRODUCT, active: true },
            { onConflict: "client_id,product" }
          );
        if (prodErr) console.error("[intake/submit] client_products upsert failed:", prodErr);
        heraldEnabled = !prodErr;
      }

      if (plan.setAgentName) {
        await supabaseAdmin
          .from("clients")
          .update({ chatbot_agent_name: plan.setAgentName })
          .eq("id", clientId);
      }

      if (plan.sendInvite) {
        try {
          await getWorkOS().userManagement.sendInvitation({ email });
          await supabaseAdmin
            .from("clients")
            .update({ invited_at: new Date().toISOString() })
            .eq("id", clientId);
          invited = true;
        } catch (e) {
          // Non-fatal (mirrors convert); invited_at stays null so a retry can invite.
          console.warn("[intake/submit] WorkOS invite failed:", e);
        }
      }

      await logEvent({
        clientId,
        sessionId,
        category: "intake",
        message: `Herald intake submitted — product ${heraldEnabled ? "enabled" : "unchanged"}, invite ${invited ? "sent" : "skipped"}`,
        metadata: { heraldEnabled, invited, agentName: plan.setAgentName },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    notionPageId,
    notionError,
    submittedAt: new Date().toISOString(),
    clientId,
    heraldEnabled,
    invited,
  });
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — clean.
Run: `node --import tsx --test --test-concurrency=1 'lib/**/*.test.ts'` — all pass.
Confirm by reading the diff that everything above the Herald block is byte-identical to the previous file (generic behavior unchanged).

- [ ] **Step 3: Commit**

```bash
git add "app/api/intake/[sessionId]/submit/route.ts"
git commit -m "feat(intake): hands-off Herald automation on submit (product + agent name + guarded invite)"
```

---

### Task 8: Herald answers on the Notion page (`lib/notion.ts`)

**Files:**
- Modify: `lib/notion.ts`

**Interfaces:**
- Consumes: `heraldAnswers` from `lib/intake/herald` (Task 1); existing local helpers `h2()`, `para()`, `bullet()`, `divider()`.
- Produces: when `state.herald` exists, a "Herald Setup" section appears on the intake Notion page (between "SOPs & Docs" and "Kickoff Call"). Generic intakes (no `state.herald`) produce a byte-identical page to before.

- [ ] **Step 1: Add the import**

At the top of `lib/notion.ts`, after `import { Client } from "@notionhq/client";` add:

```ts
import { heraldAnswers } from "@/lib/intake/herald";
```

- [ ] **Step 2: Insert the Herald section**

In `createIntakePage`, inside the `notion.blocks.children.append({ children: [...] })` array, find:

```ts
      h2("SOPs & Docs"),
      ...fileBlocks,
      ...(sops.pastedText ? [para(`Pasted notes:\n${sops.pastedText.slice(0, 2000)}`)] : []),
      ...(sops.additionalLinks ? [para(`Links: ${sops.additionalLinks}`)] : []),
      divider(),

      h2("Kickoff Call"),
```

and insert between the `divider(),` and `h2("Kickoff Call"),`:

```ts
      ...(state.herald
        ? (() => {
            const ha = heraldAnswers(state);
            return [
              h2("Herald Setup"),
              bullet(`Agent name: ${ha.voice.agentName || "—"} · Tone: ${ha.voice.tone || "—"}`),
              ...(ha.voice.avoid ? [bullet(`Avoid: ${ha.voice.avoid}`)] : []),
              bullet(
                `Website: ${ha.website.url || "—"}`
                + (ha.website.platform ? ` · Platform: ${ha.website.platform}` : "")
                + (ha.website.snippetAccess ? ` · Snippet: ${ha.website.snippetAccess}` : "")
              ),
              para(`Products & services: ${ha.knowledge.services || "—"}`),
              ...(ha.knowledge.faqs ? [para(`Top FAQs: ${ha.knowledge.faqs}`)] : []),
              ...(ha.knowledge.hours ? [para(`Hours: ${ha.knowledge.hours}`)] : []),
              ...(ha.knowledge.policies ? [para(`Policies: ${ha.knowledge.policies}`)] : []),
              bullet(
                `Leads → ${ha.leads.destination || "—"}`
                + (ha.leads.contact ? ` · Handled by: ${ha.leads.contact}` : "")
                + (ha.leads.bookingLink ? ` · Booking: ${ha.leads.bookingLink}` : "")
              ),
              divider(),
            ];
          })()
        : []),
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — clean.
Run: `node --import tsx --test --test-concurrency=1 'lib/**/*.test.ts'` — all pass.

- [ ] **Step 4: Commit**

```bash
git add lib/notion.ts
git commit -m "feat(intake): Herald setup answers on the intake Notion page"
```

---

### Task 9: Admin convert parity (`app/api/admin/submissions/[id]/convert/route.ts`)

**Files:**
- Modify: `app/api/admin/submissions/[id]/convert/route.ts`

**Interfaces:**
- Consumes: `HERALD_PRODUCT`, `heraldAnswers` from `lib/intake/herald` (Task 1); `intake_sessions.intended_product`.
- Produces: converting a Herald submission manually yields the same `client_products` row + `chatbot_agent_name` mapping as the auto path. The existing invite behavior in this route is UNCHANGED (spec: "The invite logic there is unchanged"). Response gains `heraldEnabled`.

- [ ] **Step 1: Modify the route**

Replace `app/api/admin/submissions/[id]/convert/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { requireAdmin } from "@/lib/admin-auth";
import { HERALD_PRODUCT, heraldAnswers } from "@/lib/intake/herald";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const { data: session } = await supabaseAdmin
    .from("intake_sessions")
    .select("id, state, intended_product")
    .eq("id", id)
    .single();

  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const state = session.state as Record<string, Record<string, string>>;
  const contact = state.contact ?? {};

  const email = contact.email;
  if (!email) return NextResponse.json({ error: "No email on this submission" }, { status: 400 });

  // Upsert client — won't overwrite if they already exist
  const { data: inserted, error: dbErr } = await supabaseAdmin
    .from("clients")
    .upsert(
      {
        email,
        name: contact.name || null,
        company: contact.company || null,
        intake_session_id: id,
      },
      { onConflict: "email", ignoreDuplicates: true }
    )
    .select("id");

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  // ignoreDuplicates returns 0 rows on conflict — fall back to fetching the existing record
  let clientId: string | null = inserted?.[0]?.id ?? null;
  if (!clientId) {
    const { data: existing } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("email", email)
      .single();
    clientId = existing?.id ?? null;
  }

  if (!clientId) return NextResponse.json({ error: "Could not find or create client" }, { status: 500 });

  // Herald-link parity: manual convert enables the product + maps the agent
  // name exactly like the hands-off submit path.
  let heraldEnabled = false;
  if (session.intended_product === HERALD_PRODUCT) {
    const { error: prodErr } = await supabaseAdmin
      .from("client_products")
      .upsert(
        { client_id: clientId, product: HERALD_PRODUCT, active: true },
        { onConflict: "client_id,product" }
      );
    if (prodErr) console.error("[convert] client_products upsert failed:", prodErr);
    heraldEnabled = !prodErr;

    const agentName = heraldAnswers(state).voice.agentName.trim();
    if (agentName) {
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("chatbot_agent_name")
        .eq("id", clientId)
        .single();
      if (client && !client.chatbot_agent_name) {
        await supabaseAdmin
          .from("clients")
          .update({ chatbot_agent_name: agentName })
          .eq("id", clientId);
      }
    }
  }

  // Send WorkOS invite
  try {
    const workos = getWorkOS();
    await workos.userManagement.sendInvitation({ email });
  } catch (e) {
    console.warn("WorkOS invite failed (may already exist):", e);
  }

  return NextResponse.json({ ok: true, clientId, heraldEnabled });
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — clean.

- [ ] **Step 3: Commit**

```bash
git add "app/api/admin/submissions/[id]/convert/route.ts"
git commit -m "feat(admin): Herald product parity on manual submission convert"
```

---

### Task 10: Admin surfaces — Herald badge + setup-answers panel

**Files:**
- Modify: `app/(admin)/submissions/page.tsx`
- Modify: `app/(admin)/submissions/[id]/page.tsx`

**Interfaces:**
- Consumes: `intake_sessions.intended_product`; `heraldAnswers`, `HERALD_PRODUCT` from `lib/intake/herald` (Task 1); existing admin classes `prod-chip herald`, `Section`/`Field` components in the detail page.
- Produces: list rows show a `Herald` chip in the Source column; the detail page shows a read-only "Herald setup answers" section for herald submissions.

- [ ] **Step 1: List page — select the column and render the chip**

In `app/(admin)/submissions/page.tsx`, change the query select from:

```tsx
    .select("id, state, submitted_at, notion_page_id, source")
```

to:

```tsx
    .select("id, state, submitted_at, notion_page_id, source, intended_product")
```

Then change the Source cell from:

```tsx
        <span className="at-email">{s.source || "web"}</span>
```

to:

```tsx
        <span className="at-email">
          {s.source || "web"}
          {s.intended_product === "herald" && (
            <span className="prod-chip herald" style={{ marginLeft: 6 }}>Herald</span>
          )}
        </span>
```

- [ ] **Step 2: Detail page — Herald setup answers panel**

In `app/(admin)/submissions/[id]/page.tsx` (it already selects `*`, so `intended_product` is available):

Add the import at the top with the other imports:

```tsx
import { HERALD_PRODUCT, heraldAnswers } from "@/lib/intake/herald";
```

After the existing state-parsing block (the lines destructuring `contact`, `about`, `goals`, …), add:

```tsx
  const isHerald = session.intended_product === HERALD_PRODUCT;
  const herald = isHerald ? heraldAnswers(state as Record<string, unknown>) : null;
```

Then, directly after the closing `</Section>` of the Contact section (`<Section title="Contact">…</Section>`), insert:

```tsx
          {herald && (
            <Section title="Herald setup answers">
              <div style={{ marginBottom: 10 }}>
                <span className="prod-chip herald">Herald signup</span>
              </div>
              <Field label="Agent name" value={herald.voice.agentName} />
              <Field label="Tone" value={herald.voice.tone} />
              <Field label="Avoid" value={herald.voice.avoid} />
              <Field label="Website" value={herald.website.url} />
              <Field label="Platform" value={herald.website.platform} />
              <Field label="Snippet access" value={herald.website.snippetAccess} />
              <Field label="Products & services" value={herald.knowledge.services} />
              <Field label="Top FAQs" value={herald.knowledge.faqs} />
              <Field label="Hours" value={herald.knowledge.hours} />
              <Field label="Policies" value={herald.knowledge.policies} />
              <Field label="Leads go to" value={herald.leads.destination} />
              <Field label="Lead handler" value={herald.leads.contact} />
              <Field label="Booking link" value={herald.leads.bookingLink} />
            </Section>
          )}
```

(`Field` already returns `null` for empty values, so sparse answers render cleanly.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/submissions/page.tsx" "app/(admin)/submissions/[id]/page.tsx"
git commit -m "feat(admin): Herald badge on submissions list + setup-answers panel on detail"
```

---

### Task 11: Integration smoke + full verification

**Files:** none created (verification only).

**Interfaces:** exercises Tasks 2–6 against the dev server; does NOT call `/submit` (it would create a Notion page, send a Resend email, and fire a WorkOS invite — real side effects).

⚠️ The dev server talks to the production Supabase. The smoke creates one throwaway `intake_sessions` row and deletes it at the end. **Never POST to `/submit` during this task.** Note: migration 031 must be applied for the smoke to pass — if `supabase db push` has not been run yet by the operator, run `npx supabase db push` first if credentials allow it, otherwise SKIP steps 2–5, note it in the report, and rely on typecheck + suite.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` in the background; wait for `Ready`.

- [ ] **Step 2: Mint a Herald session via the API (what the entry page does)**

```bash
curl -s -X POST http://localhost:3000/api/intake/new \
  -H "Content-Type: application/json" \
  -d '{"source":"herald-link","intendedProduct":"herald"}'
```
Expected: `{ "sessionId": "sess_…", … }`. Capture `SID`.

- [ ] **Step 3: Serve-route branch check**

```bash
curl -s http://localhost:3000/intake/$SID | grep -o "GB2G_INTAKE_MODE\|intake-herald-app.js" | sort -u
```
Expected: both strings present. Then mint a GENERIC session (`-d '{}'`) and confirm its serve output contains `intake-app.js` and does NOT contain `GB2G_INTAKE_MODE` (regression check).

- [ ] **Step 4: Autosave round-trip**

```bash
curl -s -X PATCH http://localhost:3000/api/intake/$SID \
  -H "Content-Type: application/json" \
  -d '{"contact":{"name":"Smoke","email":"smoke@example.com","company":"SmokeCo"},"herald":{"voice":{"agentName":"Testy"}}}'
curl -s http://localhost:3000/api/intake/$SID
```
Expected: PATCH → `{ ok: true, … }`; GET returns the herald sub-tree intact.

- [ ] **Step 5: Entry page**

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}" http://localhost:3000/intake/herald
```
Expected: `307` (or `303`) with `redirect_url` ending in `/intake/sess_…`.

- [ ] **Step 6: Clean up the throwaway sessions**

Delete every session this task created (the herald ones AND the generic regression one), e.g.:

```bash
node --import tsx -e "
import { supabaseAdmin } from './lib/supabase';
const ids = process.argv.slice(1);
const { error } = await supabaseAdmin.from('intake_sessions').delete().in('id', ids);
console.log(error ?? 'deleted: ' + ids.join(', '));
" "$SID" "$GENERIC_SID"
```
Expected: `deleted: …`. Stop the dev server.

- [ ] **Step 7: Full suite + typecheck**

Run: `node --import tsx --test --test-concurrency=1 'lib/**/*.test.ts'` — ALL pass (expect 233 = 222 existing + 11 new).
Run: `npm run typecheck` — clean.

- [ ] **Step 8: Commit any fixes found**

If the smoke surfaced fixes, commit them (`fix(intake): …`). Otherwise nothing to commit.

---

## Self-Review (completed by plan author)

1. **Spec coverage:** start loop → Tasks 2, 3, 6; fill loop (8 stages) → Tasks 4, 5; finish loop → Task 7; admin parity → Task 9; admin surfaces → Task 10; Notion → Task 8; migration → Task 2; guards/idempotency → Tasks 1, 7; error handling → mirrored existing idioms in each route; regression → generic files untouched, serve/submit generic paths byte-identical.
2. **Placeholder scan:** none — every step has complete code or exact commands.
3. **Type consistency:** `heraldAnswers`/`planHeraldAutomation`/`HERALD_PRODUCT` names and the `state.herald.{website,knowledge,voice,leads}` shape are identical in Tasks 1, 5, 7, 8, 9, 10. The front-end `DEFAULT_STATE.herald` matches `HeraldAnswers` key-for-key.

**Deviations from spec (intentional):** migration is `031` not `027` (collision); Herald form omits the Ask-Herald sidebar/modal of the generic form (slim by design); `intendedProduct` is whitelisted server-side (public endpoint hardening).

**Operator steps after merge (NOT build steps):** `supabase db push` (applies 031). Everything else uses existing env.
