# Sawyer — Proposal Composer Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Sawyer," an admin-only chat agent that drafts formal, export-ready client proposals grounded in canonical GB2G knowledge + live client data, exportable as a branded link and a PDF.

**Architecture:** A `lib/sawyer/` module (pure logic + thin Supabase wrappers, mirroring `lib/hollis/`) powers an SSE chat route (`/api/admin/sawyer/chat`, modeled on `app/api/herald/route.ts`) using `claude-sonnet-4-6` with a single `finalize_proposal` tool. Proposals persist in two new tables (migration `030`). Exports render from structured sections to branded HTML (public token page) and PDF (`@react-pdf/renderer`). Admin UI lives under the Agents hub.

**Tech Stack:** Next.js 16 (App Router), `@anthropic-ai/sdk`, Supabase (`supabaseAdmin` service role), `@react-pdf/renderer`, WorkOS (`requireAdmin`), `node:test`/`node:assert`.

## Global Constraints

- Tests use `node:test` + `node:assert/strict`, colocated as `lib/sawyer/*.test.ts`. Run: `npm test` (full) — must pass serially: `node --import tsx --test --test-concurrency=1 'lib/**/*.test.ts'`.
- `npm run typecheck` (`tsc --noEmit`) must stay clean.
- DB access ONLY via `const { supabaseAdmin } = await import("@/lib/supabase");` inside functions (lazy import — matches repo convention; keeps pure logic testable without a DB).
- Model: `claude-sonnet-4-6`. Never Haiku for Sawyer.
- All `/api/admin/sawyer/*` routes call `requireAdmin()` first: `const guard = await requireAdmin(); if (!guard.ok) return guard.response;`.
- Voice rules (copied verbatim into the system prompt): warm, plain-spoken, no jargon, no hype, **no scripture quotes in product/proposal context**, clients keep all code & data, NDAs signed on request.
- Rate card is the single source of truth for pricing; the model must not invent prices absent from it without flagging `needs_confirmation`.
- Migration files are sequential; the next number is `030` (latest is `029_onboarding.sql`).
- The public proposal page is the ONLY un-gated surface; access control is the unguessable `public_token`.

---

### Task 1: Migration `030_proposals.sql` + types

**Files:**
- Create: `supabase/migrations/030_proposals.sql`
- Create: `lib/sawyer/types.ts`
- Test: `lib/sawyer/types.test.ts`

**Interfaces:**
- Produces: types `ProposalStatus`, `PricingSource`, `PricingCadence`, `PricingLineItem`, `ProposalPricing`, `ProposalSection`, `Proposal`, `ChatMessage`, `RateCardItem`, `ClientContext`, `ProspectContext`, `SawyerContext`; const `PROPOSAL_STATUSES`.

- [ ] **Step 1: Write the migration**

```sql
-- 030_proposals.sql — Sawyer proposal composer
create table proposals (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references clients(id) on delete set null,
  prospect_name text,
  title         text not null,
  status        text not null default 'draft'
                  check (status in ('draft','sent','accepted','declined')),
  sections      jsonb not null default '[]'::jsonb,
  pricing       jsonb,
  markdown      text,
  public_token  text unique not null,
  viewed_at     timestamptz,
  created_by    text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index proposals_client_id_idx on proposals(client_id);
create index proposals_status_idx on proposals(status);

create table proposal_messages (
  id          uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index proposal_messages_proposal_id_idx on proposal_messages(proposal_id);
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/sawyer/types.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROPOSAL_STATUSES } from "./types";

test("PROPOSAL_STATUSES has the four lifecycle states", () => {
  assert.deepEqual([...PROPOSAL_STATUSES].sort(), ["accepted", "declined", "draft", "sent"]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- lib/sawyer/types.test.ts` (or `node --import tsx --test 'lib/sawyer/types.test.ts'`)
Expected: FAIL — cannot find module `./types`.

- [ ] **Step 4: Write `types.ts`**

```typescript
// lib/sawyer/types.ts
export const PROPOSAL_STATUSES = ["draft", "sent", "accepted", "declined"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export type PricingSource = "rate_card" | "custom_override" | "needs_confirmation";
export type PricingCadence = "monthly" | "one_time" | "annual";

export type PricingLineItem = {
  label: string;
  amount: number | null; // null when needs_confirmation
  cadence: PricingCadence;
  note?: string;
};

export type ProposalPricing = {
  source: PricingSource;
  items: PricingLineItem[];
  summary?: string;
};

export type ProposalSection = {
  key: string;     // e.g. "cover", "about", "scope", "pricing", "timeline", "terms"
  heading: string;
  body: string;    // markdown
};

export type Proposal = {
  id: string;
  client_id: string | null;
  prospect_name: string | null;
  title: string;
  status: ProposalStatus;
  sections: ProposalSection[];
  pricing: ProposalPricing | null;
  markdown: string | null;
  public_token: string;
  viewed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type RateCardItem = {
  key: string;          // "hollis" | "herald" | "atrium" | "steward"
  product: string;      // display name
  summary: string;      // one line of what it is
  display: string;      // human price string, e.g. "$1,500–$5,000/mo"
  amount: number | null;
  cadence: PricingCadence | null;
  status: "available" | "launching" | "custom";
};

export type ClientContext = {
  kind: "client";
  id: string;
  name: string;
  company: string;
  email: string;
  status: string;
  products: string[];
  memberCount: number;
  hasHollis: boolean;
  hollisSummary?: string;
  recentTicketCount: number;
};

export type ProspectContext = {
  kind: "prospect";
  name: string;
  company?: string;
  notes?: string;
};

export type SawyerContext = ClientContext | ProspectContext;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- lib/sawyer/types.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/030_proposals.sql lib/sawyer/types.ts lib/sawyer/types.test.ts
git commit -m "feat(sawyer): migration 030 proposals + core types"
```

---

### Task 2: `company.ts` — canonical GB2G knowledge + rate card

**Files:**
- Create: `lib/sawyer/company.ts`
- Test: `lib/sawyer/company.test.ts`

**Interfaces:**
- Consumes: `RateCardItem` from `./types`.
- Produces: `RATE_CARD: RateCardItem[]`, `getRateCardItem(key: string): RateCardItem | undefined`, `GB2G_IDENTITY: string`, `GB2G_VOICE_RULES: string`, `GB2G_BOILERPLATE_TERMS: string`, `rateCardForPrompt(): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/sawyer/company.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { RATE_CARD, getRateCardItem, rateCardForPrompt, GB2G_IDENTITY, GB2G_VOICE_RULES } from "./company";

test("rate card includes the four products by key", () => {
  const keys = RATE_CARD.map((r) => r.key).sort();
  assert.deepEqual(keys, ["atrium", "herald", "hollis", "steward"]);
});

test("every rate card item has a display price and a valid status", () => {
  for (const item of RATE_CARD) {
    assert.ok(item.display.length > 0, `${item.key} missing display`);
    assert.ok(["available", "launching", "custom"].includes(item.status), `${item.key} bad status`);
  }
});

test("Hollis is the voice-AI managed tier", () => {
  const h = getRateCardItem("hollis");
  assert.ok(h);
  assert.match(h!.display, /1,500/);
  assert.match(h!.display, /5,000/);
});

test("getRateCardItem returns undefined for unknown key", () => {
  assert.equal(getRateCardItem("nope"), undefined);
});

test("rateCardForPrompt lists every product with its price", () => {
  const s = rateCardForPrompt();
  assert.match(s, /Hollis/);
  assert.match(s, /Atrium/);
  assert.match(s, /18,000/);
});

test("identity is faith-rooted but business-first; voice forbids scripture in product context", () => {
  assert.match(GB2G_IDENTITY, /faith-rooted/i);
  assert.match(GB2G_VOICE_RULES, /scripture/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/sawyer/company.test.ts`
Expected: FAIL — cannot find module `./company`.

- [ ] **Step 3: Write `company.ts`**

```typescript
// lib/sawyer/company.ts
// Canonical GB2G knowledge — the "knows us" layer for Sawyer.
// Consolidates facts otherwise scattered across public/about.html and
// lib/anthropic.ts prompt copy. Single source of truth for proposals.
import type { RateCardItem } from "./types";

export const RATE_CARD: RateCardItem[] = [
  {
    key: "hollis",
    product: "Hollis — AI phone receptionist",
    summary:
      "Answers the business phone in a chosen human voice; books appointments, qualifies leads, answers FAQs, takes messages, warm-transfers. Inbound, AI-disclosed, recorded.",
    display: "$1,500–$5,000/mo (managed tiers)",
    amount: null, // tiered — Sawyer selects within the range per scope
    cadence: "monthly",
    status: "available",
  },
  {
    key: "herald",
    product: "Herald — website AI agent",
    summary: "Conversational website agent that greets, qualifies, books, and hands off.",
    display: "$2,400/mo",
    amount: 2400,
    cadence: "monthly",
    status: "available",
  },
  {
    key: "atrium",
    product: "Atrium — AI-assisted website build",
    summary: "AI-assisted website design and build.",
    display: "$18,000/site",
    amount: 18000,
    cadence: "one_time",
    status: "available",
  },
  {
    key: "steward",
    product: "Steward — internal AI employees",
    summary: "Internal AI employees for ops, research, finance, and support.",
    display: "Custom (launching Q2 2026)",
    amount: null,
    cadence: null,
    status: "launching",
  },
];

export function getRateCardItem(key: string): RateCardItem | undefined {
  return RATE_CARD.find((r) => r.key === key);
}

export const GB2G_IDENTITY = `GB2GLLC (GloryBe2God LLC) is a faith-rooted but business-first AI software studio. Founded by John — a former Chick-fil-A operator with a banking background — GB2G builds practical AI agents for businesses that understand operations, not VC-lab posturing. Clients keep all code and data.`;

export const GB2G_VOICE_RULES = `Voice: warm, plain-spoken, confident, no jargon, no hype. Do NOT quote scripture in proposal or product context. Write like an operator talking to another operator. Concrete over clever.`;

export const GB2G_BOILERPLATE_TERMS = `- Ownership: the client keeps all code and data we produce for them.
- NDAs: signed on request.
- Engagement: month-to-month for managed services unless a term is specified; one-time builds are fixed-scope with a defined deliverable.`;

export function rateCardForPrompt(): string {
  return RATE_CARD.map((r) => `- ${r.product}: ${r.display} — ${r.summary}`).join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/sawyer/company.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sawyer/company.ts lib/sawyer/company.test.ts
git commit -m "feat(sawyer): canonical company knowledge + rate card"
```

---

### Task 3: `context.ts` — live client context (pure shaper + thin fetchers)

**Files:**
- Create: `lib/sawyer/context.ts`
- Test: `lib/sawyer/context.test.ts`

**Interfaces:**
- Consumes: `ClientContext`, `ProspectContext` from `./types`.
- Produces: `shapeClientContext(input): ClientContext` (pure), `buildProspectContext(input): ProspectContext` (pure), `getClientContext(clientId: string): Promise<ClientContext | null>` (thin), `searchClients(q: string): Promise<Array<{ id: string; name: string; company: string }>>` (thin).
- `shapeClientContext` input shape: `{ client: { id; name; company; email; status }; products: Array<{ product: string; active: boolean }>; memberCount: number; hollisLine: { agent_name?: string; voice_profile?: string } | null; recentTicketCount: number }`.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/sawyer/context.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeClientContext, buildProspectContext } from "./context";

const base = {
  client: { id: "c1", name: "Jane Doe", company: "BrightLens Media", email: "jane@bright.io", status: "active" },
  products: [
    { product: "hollis", active: true },
    { product: "herald", active: false },
  ],
  memberCount: 3,
  hollisLine: { agent_name: "Ava", voice_profile: "female" },
  recentTicketCount: 2,
};

test("shapeClientContext keeps only active products and never leaks raw rows", () => {
  const ctx = shapeClientContext(base);
  assert.equal(ctx.kind, "client");
  assert.deepEqual(ctx.products, ["hollis"]);
  assert.equal(ctx.company, "BrightLens Media");
  assert.equal(ctx.hasHollis, true);
  assert.match(ctx.hollisSummary ?? "", /Ava/);
  // shape is flat primitives only — no nested row objects
  assert.equal(typeof ctx.memberCount, "number");
  assert.ok(!("client" in (ctx as object)));
});

test("shapeClientContext without Hollis sets hasHollis false and no summary", () => {
  const ctx = shapeClientContext({ ...base, products: [], hollisLine: null });
  assert.equal(ctx.hasHollis, false);
  assert.equal(ctx.hollisSummary, undefined);
  assert.deepEqual(ctx.products, []);
});

test("buildProspectContext trims and carries notes", () => {
  const p = buildProspectContext({ name: "  Acme Corp ", company: "Acme", notes: "referred by X" });
  assert.equal(p.kind, "prospect");
  assert.equal(p.name, "Acme Corp");
  assert.equal(p.notes, "referred by X");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/sawyer/context.test.ts`
Expected: FAIL — cannot find module `./context`.

- [ ] **Step 3: Write `context.ts`**

```typescript
// lib/sawyer/context.ts
// The "live" knowledge layer: shapes Supabase rows into a compact, typed
// context for Sawyer. Pure shapers are unit-tested; fetchers are thin
// lazy-import wrappers (repo convention).
import type { ClientContext, ProspectContext } from "./types";

type ShapeInput = {
  client: { id: string; name: string; company: string; email: string; status: string };
  products: Array<{ product: string; active: boolean }>;
  memberCount: number;
  hollisLine: { agent_name?: string; voice_profile?: string } | null;
  recentTicketCount: number;
};

export function shapeClientContext(input: ShapeInput): ClientContext {
  const products = input.products.filter((p) => p.active).map((p) => p.product);
  const hasHollis = !!input.hollisLine;
  const hollisSummary = input.hollisLine
    ? `Hollis live as "${input.hollisLine.agent_name ?? "the receptionist"}" (${input.hollisLine.voice_profile ?? "voice set"}).`
    : undefined;
  return {
    kind: "client",
    id: input.client.id,
    name: input.client.name ?? "",
    company: input.client.company ?? "",
    email: input.client.email ?? "",
    status: input.client.status ?? "unknown",
    products,
    memberCount: input.memberCount,
    hasHollis,
    hollisSummary,
    recentTicketCount: input.recentTicketCount,
  };
}

export function buildProspectContext(input: { name: string; company?: string; notes?: string }): ProspectContext {
  return {
    kind: "prospect",
    name: input.name.trim(),
    company: input.company?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
  };
}

export async function getClientContext(clientId: string): Promise<ClientContext | null> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name, company, email, status")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return null;

  const [{ data: products }, { count: memberCount }, { data: hollisLine }, { count: ticketCount }] =
    await Promise.all([
      supabaseAdmin.from("client_products").select("product, active").eq("client_id", clientId),
      supabaseAdmin.from("client_members").select("id", { count: "exact", head: true }).eq("client_id", clientId),
      supabaseAdmin
        .from("hollis_lines")
        .select("agent_name, voice_profile")
        .eq("client_id", clientId)
        .maybeSingle()
        .then((r) => r),
      supabaseAdmin.from("tickets").select("id", { count: "exact", head: true }).eq("client_id", clientId),
    ]);

  return shapeClientContext({
    client: client as ShapeInput["client"],
    products: (products ?? []) as ShapeInput["products"],
    memberCount: memberCount ?? 0,
    hollisLine: (hollisLine as ShapeInput["hollisLine"]) ?? null,
    recentTicketCount: ticketCount ?? 0,
  });
}

export async function searchClients(q: string): Promise<Array<{ id: string; name: string; company: string }>> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const term = q.trim();
  let query = supabaseAdmin.from("clients").select("id, name, company").order("name").limit(20);
  if (term) query = query.or(`name.ilike.%${term}%,company.ilike.%${term}%`);
  const { data } = await query;
  return (data ?? []) as Array<{ id: string; name: string; company: string }>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/sawyer/context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sawyer/context.ts lib/sawyer/context.test.ts
git commit -m "feat(sawyer): live client context shaper + fetchers"
```

---

### Task 4: `store.ts` — persistence (pure helpers + thin CRUD)

**Files:**
- Create: `lib/sawyer/store.ts`
- Test: `lib/sawyer/store.test.ts`

**Interfaces:**
- Consumes: `Proposal`, `ProposalSection`, `ProposalPricing`, `ChatMessage` from `./types`.
- Produces: `generateToken(): string`, `flattenToMarkdown(title, sections, pricing): string` (pure); `createProposal(input): Promise<Proposal>`, `getProposal(id): Promise<Proposal | null>`, `getProposalByToken(token): Promise<Proposal | null>`, `listProposals(): Promise<Proposal[]>`, `updateProposal(id, patch): Promise<Proposal>`, `markViewed(token): Promise<void>`, `appendMessage(proposalId, role, content): Promise<void>`, `getMessages(proposalId): Promise<ChatMessage[]>` (thin).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/sawyer/store.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateToken, flattenToMarkdown } from "./store";

test("generateToken is url-safe and >= 24 chars and unique", () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 24);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("flattenToMarkdown renders headings, bodies, and a pricing block", () => {
  const md = flattenToMarkdown(
    "Proposal for BrightLens",
    [
      { key: "about", heading: "About GB2G", body: "We build practical AI." },
      { key: "scope", heading: "Scope", body: "Hollis receptionist." },
    ],
    {
      source: "rate_card",
      items: [{ label: "Hollis — Growth", amount: 3000, cadence: "monthly" }],
      summary: "Month-to-month.",
    }
  );
  assert.match(md, /# Proposal for BrightLens/);
  assert.match(md, /## About GB2G/);
  assert.match(md, /We build practical AI\./);
  assert.match(md, /## Pricing/);
  assert.match(md, /Hollis — Growth/);
  assert.match(md, /\$3,000\/mo/);
});

test("flattenToMarkdown tolerates null pricing", () => {
  const md = flattenToMarkdown("X", [{ key: "a", heading: "A", body: "b" }], null);
  assert.match(md, /## A/);
  assert.ok(!md.includes("## Pricing"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/sawyer/store.test.ts`
Expected: FAIL — cannot find module `./store`.

- [ ] **Step 3: Write `store.ts`**

```typescript
// lib/sawyer/store.ts
import { randomBytes } from "node:crypto";
import type { ChatMessage, Proposal, ProposalPricing, ProposalSection, ProposalStatus } from "./types";

export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

const CADENCE_SUFFIX: Record<string, string> = { monthly: "/mo", annual: "/yr", one_time: "" };

function formatAmount(amount: number | null, cadence: string): string {
  if (amount == null) return "TBD (to confirm)";
  return `$${amount.toLocaleString("en-US")}${CADENCE_SUFFIX[cadence] ?? ""}`;
}

export function flattenToMarkdown(
  title: string,
  sections: ProposalSection[],
  pricing: ProposalPricing | null
): string {
  const parts: string[] = [`# ${title}`];
  for (const s of sections) {
    parts.push(`## ${s.heading}\n\n${s.body}`);
  }
  if (pricing) {
    const lines = pricing.items.map((i) => `- **${i.label}** — ${formatAmount(i.amount, i.cadence)}${i.note ? ` (${i.note})` : ""}`);
    parts.push(`## Pricing\n\n${lines.join("\n")}${pricing.summary ? `\n\n${pricing.summary}` : ""}`);
  }
  return parts.join("\n\n");
}

type CreateInput = {
  client_id: string | null;
  prospect_name: string | null;
  title: string;
  sections: ProposalSection[];
  pricing: ProposalPricing | null;
  created_by: string;
};

function rowToProposal(row: Record<string, unknown>): Proposal {
  return row as unknown as Proposal;
}

export async function createProposal(input: CreateInput): Promise<Proposal> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const markdown = flattenToMarkdown(input.title, input.sections, input.pricing);
  const { data, error } = await supabaseAdmin
    .from("proposals")
    .insert({
      client_id: input.client_id,
      prospect_name: input.prospect_name,
      title: input.title,
      sections: input.sections,
      pricing: input.pricing,
      markdown,
      public_token: generateToken(),
      created_by: input.created_by,
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToProposal(data);
}

export async function getProposal(id: string): Promise<Proposal | null> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin.from("proposals").select("*").eq("id", id).maybeSingle();
  return data ? rowToProposal(data) : null;
}

export async function getProposalByToken(token: string): Promise<Proposal | null> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin.from("proposals").select("*").eq("public_token", token).maybeSingle();
  return data ? rowToProposal(data) : null;
}

export async function listProposals(): Promise<Proposal[]> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin.from("proposals").select("*").order("updated_at", { ascending: false });
  return (data ?? []).map(rowToProposal);
}

type UpdatePatch = {
  title?: string;
  status?: ProposalStatus;
  sections?: ProposalSection[];
  pricing?: ProposalPricing | null;
};

export async function updateProposal(id: string, patch: UpdatePatch): Promise<Proposal> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const existing = await getProposal(id);
  if (!existing) throw new Error("proposal not found");
  const title = patch.title ?? existing.title;
  const sections = patch.sections ?? existing.sections;
  const pricing = patch.pricing !== undefined ? patch.pricing : existing.pricing;
  const markdown = flattenToMarkdown(title, sections, pricing);
  const { data, error } = await supabaseAdmin
    .from("proposals")
    .update({ ...patch, markdown, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToProposal(data);
}

export async function markViewed(token: string): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  await supabaseAdmin
    .from("proposals")
    .update({ viewed_at: new Date().toISOString() })
    .eq("public_token", token)
    .is("viewed_at", null);
}

export async function appendMessage(proposalId: string, role: "user" | "assistant", content: string): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  await supabaseAdmin.from("proposal_messages").insert({ proposal_id: proposalId, role, content });
}

export async function getMessages(proposalId: string): Promise<ChatMessage[]> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin
    .from("proposal_messages")
    .select("role, content")
    .eq("proposal_id", proposalId)
    .order("created_at");
  return (data ?? []) as ChatMessage[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/sawyer/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sawyer/store.ts lib/sawyer/store.test.ts
git commit -m "feat(sawyer): proposal persistence + markdown flattener"
```

---

### Task 5: `prompt.ts` — system prompt assembly

**Files:**
- Create: `lib/sawyer/prompt.ts`
- Test: `lib/sawyer/prompt.test.ts`

**Interfaces:**
- Consumes: `SawyerContext` from `./types`; `GB2G_IDENTITY`, `GB2G_VOICE_RULES`, `GB2G_BOILERPLATE_TERMS`, `rateCardForPrompt` from `./company`.
- Produces: `SECTION_BLUEPRINT: string`, `buildSawyerSystemPrompt(ctx: SawyerContext): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/sawyer/prompt.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSawyerSystemPrompt } from "./prompt";

test("system prompt includes identity, rate card, voice rules, and pricing-source rule", () => {
  const p = buildSawyerSystemPrompt({
    kind: "client",
    id: "c1", name: "Jane", company: "BrightLens", email: "j@b.io", status: "active",
    products: ["hollis"], memberCount: 2, hasHollis: true, hollisSummary: 'Hollis live as "Ava".', recentTicketCount: 0,
  });
  assert.match(p, /faith-rooted/i);
  assert.match(p, /Hollis/);
  assert.match(p, /scripture/i);          // voice rule present
  assert.match(p, /BrightLens/);          // live client context injected
  assert.match(p, /rate card/i);          // pricing rule present
  assert.match(p, /needs_confirmation/);  // the finalize pricing-source rule
  assert.match(p, /finalize_proposal/);   // tells model how to finish
});

test("prospect context renders without DB fields", () => {
  const p = buildSawyerSystemPrompt({ kind: "prospect", name: "Acme Corp", company: "Acme", notes: "cold lead" });
  assert.match(p, /Acme Corp/);
  assert.match(p, /prospect/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/sawyer/prompt.test.ts`
Expected: FAIL — cannot find module `./prompt`.

- [ ] **Step 3: Write `prompt.ts`**

```typescript
// lib/sawyer/prompt.ts
import type { SawyerContext } from "./types";
import { GB2G_IDENTITY, GB2G_VOICE_RULES, GB2G_BOILERPLATE_TERMS, rateCardForPrompt } from "./company";

export const SECTION_BLUEPRINT = `A complete proposal has these sections, in order:
1. cover — client/company, prepared-by GB2G, date, a clear proposal title.
2. about — a short, voiced intro to GB2G.
3. understanding — what the client needs, in their terms.
4. scope — the proposed solution: product(s), what's included, deliverables.
5. pricing — tier + figures from the rate card.
6. timeline — phases / next steps.
7. terms — ownership, NDA, engagement basics.`;

function renderContext(ctx: SawyerContext): string {
  if (ctx.kind === "prospect") {
    return `You are drafting for a PROSPECT (not yet a client):
- Name: ${ctx.name}
- Company: ${ctx.company ?? "unknown"}
- Notes: ${ctx.notes ?? "none"}`;
  }
  return `You are drafting for an EXISTING client (live account data):
- Contact: ${ctx.name}
- Company: ${ctx.company}
- Account status: ${ctx.status}
- Active products: ${ctx.products.join(", ") || "none yet"}
- Team size: ${ctx.memberCount}
- Hollis: ${ctx.hasHollis ? ctx.hollisSummary : "not yet using Hollis"}
- Recent support tickets: ${ctx.recentTicketCount}`;
}

export function buildSawyerSystemPrompt(ctx: SawyerContext): string {
  return `You are Sawyer, GB2G's proposal writer. You draft formal, send-ready client proposals for John (the founder) to review and send.

# Who we are
${GB2G_IDENTITY}

# How we sound
${GB2G_VOICE_RULES}

# Our offerings and rate card (the ONLY source of pricing)
${rateCardForPrompt()}

# Standard terms
${GB2G_BOILERPLATE_TERMS}

# Who this proposal is for
${renderContext(ctx)}

# Proposal structure
${SECTION_BLUEPRINT}

# Pricing rules — important
- Use the rate card above. Select the right product/tier for the described scope and state your assumptions (e.g. "Hollis Growth tier, month-to-month").
- For Hollis (a $1,500–$5,000/mo range), pick a specific monthly figure that fits the scope and justify it briefly.
- If John asks for a number, use it (that's a custom override).
- NEVER invent a price that isn't on the rate card without flagging it. When you must quote something custom that John hasn't confirmed, mark that pricing item's source as needs_confirmation.

# How to work
- Ask at most 1–2 clarifying questions if scope is genuinely unclear, then draft.
- When the proposal is ready, call the finalize_proposal tool with the full structured sections and pricing. Keep chatting normally for revisions; re-call finalize_proposal after each accepted change.
- Plain text in chat; the tool carries the structured proposal.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/sawyer/prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sawyer/prompt.ts lib/sawyer/prompt.test.ts
git commit -m "feat(sawyer): system prompt assembly"
```

---

### Task 6: `chat.ts` — Anthropic loop + finalize tool + payload validation

**Files:**
- Create: `lib/sawyer/chat.ts`
- Test: `lib/sawyer/chat.test.ts`

**Interfaces:**
- Consumes: `anthropic` from `@/lib/anthropic`; `ChatMessage`, `ProposalSection`, `ProposalPricing` from `./types`.
- Produces: `SAWYER_MODEL`, `SAWYER_MAX_TOKENS`, `FINALIZE_TOOL` (Anthropic `Tool`), `validateFinalizePayload(input: unknown): { ok: true; sections: ProposalSection[]; pricing: ProposalPricing; title: string } | { ok: false; error: string }`, `streamSawyerTurn(args: { system: string; messages: ChatMessage[] })` (thin — returns `anthropic.messages.stream(...)`).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/sawyer/chat.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFinalizePayload, FINALIZE_TOOL } from "./chat";

const good = {
  title: "Proposal for BrightLens Media",
  sections: [
    { key: "about", heading: "About GB2G", body: "We build practical AI." },
    { key: "scope", heading: "Scope", body: "Hollis receptionist." },
  ],
  pricing: {
    source: "rate_card",
    items: [{ label: "Hollis — Growth", amount: 3000, cadence: "monthly" }],
    summary: "Month-to-month.",
  },
};

test("FINALIZE_TOOL is named finalize_proposal", () => {
  assert.equal(FINALIZE_TOOL.name, "finalize_proposal");
});

test("valid payload passes and returns typed parts", () => {
  const r = validateFinalizePayload(good);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.title, "Proposal for BrightLens Media");
    assert.equal(r.sections.length, 2);
    assert.equal(r.pricing.source, "rate_card");
  }
});

test("rejects pricing without a valid source", () => {
  const r = validateFinalizePayload({ ...good, pricing: { items: [], source: "guess" } });
  assert.equal(r.ok, false);
});

test("rejects missing sections", () => {
  const r = validateFinalizePayload({ title: "x", pricing: good.pricing });
  assert.equal(r.ok, false);
});

test("rejects empty title", () => {
  const r = validateFinalizePayload({ ...good, title: "" });
  assert.equal(r.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/sawyer/chat.test.ts`
Expected: FAIL — cannot find module `./chat`.

- [ ] **Step 3: Write `chat.ts`**

```typescript
// lib/sawyer/chat.ts
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/anthropic";
import type { ChatMessage, ProposalPricing, ProposalSection } from "./types";

export const SAWYER_MODEL = "claude-sonnet-4-6";
export const SAWYER_MAX_TOKENS = 2048;

const PRICING_SOURCES = ["rate_card", "custom_override", "needs_confirmation"];
const CADENCES = ["monthly", "one_time", "annual"];

export const FINALIZE_TOOL: Anthropic.Tool = {
  name: "finalize_proposal",
  description:
    "Emit the complete structured proposal so it can be saved and rendered. Call this whenever the proposal is ready or after an accepted revision.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Proposal title, e.g. 'Proposal for BrightLens Media'" },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            heading: { type: "string" },
            body: { type: "string", description: "Markdown body" },
          },
          required: ["key", "heading", "body"],
        },
      },
      pricing: {
        type: "object",
        properties: {
          source: { type: "string", enum: PRICING_SOURCES },
          summary: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                amount: { type: ["number", "null"] },
                cadence: { type: "string", enum: CADENCES },
                note: { type: "string" },
              },
              required: ["label", "cadence"],
            },
          },
        },
        required: ["source", "items"],
      },
    },
    required: ["title", "sections", "pricing"],
  },
};

type ValidateOk = { ok: true; title: string; sections: ProposalSection[]; pricing: ProposalPricing };
type ValidateErr = { ok: false; error: string };

export function validateFinalizePayload(input: unknown): ValidateOk | ValidateErr {
  const v = input as Record<string, unknown>;
  if (!v || typeof v.title !== "string" || v.title.trim().length === 0) {
    return { ok: false, error: "title required" };
  }
  if (!Array.isArray(v.sections) || v.sections.length === 0) {
    return { ok: false, error: "sections required" };
  }
  for (const s of v.sections as unknown[]) {
    const sec = s as Record<string, unknown>;
    if (typeof sec.key !== "string" || typeof sec.heading !== "string" || typeof sec.body !== "string") {
      return { ok: false, error: "each section needs key/heading/body" };
    }
  }
  const pricing = v.pricing as Record<string, unknown> | undefined;
  if (!pricing || !PRICING_SOURCES.includes(pricing.source as string)) {
    return { ok: false, error: "pricing.source must be rate_card | custom_override | needs_confirmation" };
  }
  if (!Array.isArray(pricing.items)) {
    return { ok: false, error: "pricing.items required" };
  }
  for (const it of pricing.items as unknown[]) {
    const item = it as Record<string, unknown>;
    if (typeof item.label !== "string" || !CADENCES.includes(item.cadence as string)) {
      return { ok: false, error: "each pricing item needs label + valid cadence" };
    }
    if (item.amount != null && typeof item.amount !== "number") {
      return { ok: false, error: "pricing amount must be number or null" };
    }
  }
  return {
    ok: true,
    title: (v.title as string).trim(),
    sections: v.sections as ProposalSection[],
    pricing: pricing as unknown as ProposalPricing,
  };
}

export function streamSawyerTurn(args: { system: string; messages: ChatMessage[] }) {
  return anthropic.messages.stream({
    model: SAWYER_MODEL,
    max_tokens: SAWYER_MAX_TOKENS,
    system: args.system,
    tools: [FINALIZE_TOOL],
    messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/sawyer/chat.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck (the `@anthropic-ai/sdk` Tool type is load-bearing here)**

Run: `npm run typecheck`
Expected: clean (no errors).

- [ ] **Step 6: Commit**

```bash
git add lib/sawyer/chat.ts lib/sawyer/chat.test.ts
git commit -m "feat(sawyer): anthropic chat loop + finalize_proposal tool"
```

---

### Task 7: `render.tsx` — branded HTML + PDF

**Files:**
- Create: `lib/sawyer/render.tsx`
- Test: `lib/sawyer/render.test.ts`

**Interfaces:**
- Consumes: `Proposal`, `ProposalSection` from `./types`; `flattenToMarkdown` is NOT reused here (HTML differs from markdown); `@react-pdf/renderer`.
- Produces: `orderedSections(sections: ProposalSection[]): ProposalSection[]` (pure), `renderProposalHtml(proposal: Proposal): string` (pure), `renderProposalPdf(proposal: Proposal): Promise<Buffer>` (thin — uses `renderToBuffer`).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/sawyer/render.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { orderedSections, renderProposalHtml } from "./render";
import type { Proposal } from "./types";

const proposal: Proposal = {
  id: "p1", client_id: "c1", prospect_name: null,
  title: "Proposal for BrightLens Media", status: "draft",
  sections: [
    { key: "terms", heading: "Terms", body: "Ownership stays with you." },
    { key: "cover", heading: "Cover", body: "Prepared for BrightLens." },
    { key: "scope", heading: "Scope", body: "Hollis receptionist." },
  ],
  pricing: { source: "rate_card", items: [{ label: "Hollis — Growth", amount: 3000, cadence: "monthly" }], summary: "Month-to-month." },
  markdown: null, public_token: "tok", viewed_at: null,
  created_by: "john@gb2gllc.com", created_at: "", updated_at: "",
};

test("orderedSections puts cover first and terms last", () => {
  const ord = orderedSections(proposal.sections);
  assert.equal(ord[0].key, "cover");
  assert.equal(ord[ord.length - 1].key, "terms");
});

test("renderProposalHtml is escaped, branded, includes sections + pricing", () => {
  const html = renderProposalHtml(proposal);
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /Proposal for BrightLens Media/);
  assert.match(html, /Hollis receptionist/);
  assert.match(html, /\$3,000\/mo/);
  assert.match(html, /GB2G/);
});

test("renderProposalHtml escapes HTML in body to prevent injection", () => {
  const evil = { ...proposal, sections: [{ key: "cover", heading: "Cover", body: "<script>alert(1)</script>" }] };
  const html = renderProposalHtml(evil);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/sawyer/render.test.ts`
Expected: FAIL — cannot find module `./render`.

- [ ] **Step 3: Write `render.tsx`**

```tsx
// lib/sawyer/render.tsx
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { Proposal, ProposalSection } from "./types";

const SECTION_ORDER = ["cover", "about", "understanding", "scope", "pricing", "timeline", "terms"];

export function orderedSections(sections: ProposalSection[]): ProposalSection[] {
  return [...sections].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a.key);
    const ib = SECTION_ORDER.indexOf(b.key);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const CADENCE_SUFFIX: Record<string, string> = { monthly: "/mo", annual: "/yr", one_time: "" };
function money(amount: number | null, cadence: string): string {
  if (amount == null) return "To confirm";
  return `$${amount.toLocaleString("en-US")}${CADENCE_SUFFIX[cadence] ?? ""}`;
}

function pricingRows(p: Proposal): Array<{ label: string; value: string; note?: string }> {
  if (!p.pricing) return [];
  return p.pricing.items.map((i) => ({ label: i.label, value: money(i.amount, i.cadence), note: i.note }));
}

export function renderProposalHtml(p: Proposal): string {
  const secs = orderedSections(p.sections);
  const body = secs
    .map((s) => `<section><h2>${esc(s.heading)}</h2><div class="body">${esc(s.body).replace(/\n/g, "<br/>")}</div></section>`)
    .join("\n");
  const pricing = p.pricing
    ? `<section class="pricing"><h2>Pricing</h2><table>${pricingRows(p)
        .map((r) => `<tr><td>${esc(r.label)}${r.note ? ` <span class="note">(${esc(r.note)})</span>` : ""}</td><td class="amt">${esc(r.value)}</td></tr>`)
        .join("")}</table>${p.pricing.summary ? `<p class="summary">${esc(p.pricing.summary)}</p>` : ""}</section>`
    : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(p.title)}</title>
<style>
  :root { --ink:#1a1a1a; --muted:#6b6b6b; --line:#e6e6e6; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color:var(--ink); max-width:760px; margin:0 auto; padding:48px 24px; line-height:1.6; }
  .brand { font-weight:700; letter-spacing:0.02em; color:var(--ink); }
  h1 { font-size:28px; margin:8px 0 32px; }
  h2 { font-size:18px; margin:32px 0 8px; border-bottom:1px solid var(--line); padding-bottom:6px; }
  .body { white-space:normal; }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  td { padding:8px 0; border-bottom:1px solid var(--line); }
  .amt { text-align:right; font-variant-numeric:tabular-nums; font-weight:600; }
  .note, .summary, .muted { color:var(--muted); }
  footer { margin-top:48px; color:var(--muted); font-size:13px; }
</style></head>
<body>
  <div class="brand">GB2G — GloryBe2God LLC</div>
  <h1>${esc(p.title)}</h1>
  ${body}
  ${pricing}
  <footer>Prepared by GB2G. Clients keep all code and data. Questions? Reply to the email this was sent with.</footer>
</body></html>`;
}

const pdf = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: "Helvetica", color: "#1a1a1a", lineHeight: 1.5 },
  brand: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 18 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 4 },
  body: { marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", borderBottom: "1px solid #e6e6e6", paddingVertical: 4 },
  amt: { fontFamily: "Helvetica-Bold" },
  footer: { marginTop: 28, fontSize: 9, color: "#6b6b6b" },
});

export async function renderProposalPdf(p: Proposal): Promise<Buffer> {
  const secs = orderedSections(p.sections);
  const doc = (
    <Document>
      <Page size="A4" style={pdf.page}>
        <Text style={pdf.brand}>GB2G — GloryBe2God LLC</Text>
        <Text style={pdf.title}>{p.title}</Text>
        {secs.map((s, i) => (
          <View key={i} wrap={false}>
            <Text style={pdf.h2}>{s.heading}</Text>
            <Text style={pdf.body}>{s.body}</Text>
          </View>
        ))}
        {p.pricing && (
          <View>
            <Text style={pdf.h2}>Pricing</Text>
            {pricingRows(p).map((r, i) => (
              <View key={i} style={pdf.row}>
                <Text>{r.label}{r.note ? ` (${r.note})` : ""}</Text>
                <Text style={pdf.amt}>{r.value}</Text>
              </View>
            ))}
            {p.pricing.summary ? <Text style={pdf.body}>{p.pricing.summary}</Text> : null}
          </View>
        )}
        <Text style={pdf.footer}>Prepared by GB2G. Clients keep all code and data.</Text>
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/sawyer/render.test.ts`
Expected: PASS. (Tests cover only the pure `orderedSections` + `renderProposalHtml`; the PDF path is exercised by the route in Task 10 and a manual check.)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: clean. (If JSX-in-`.tsx`-under-`lib` trips config, confirm `tsconfig` `jsx` setting covers `lib/**`; it does — the app is App-Router TSX.)

- [ ] **Step 6: Commit**

```bash
git add lib/sawyer/render.tsx lib/sawyer/render.test.ts
git commit -m "feat(sawyer): branded HTML + PDF rendering"
```

---

### Task 8: Chat SSE route `/api/admin/sawyer/chat`

**Files:**
- Create: `app/api/admin/sawyer/chat/route.ts`

**Interfaces:**
- Consumes: `requireAdmin` from `@/lib/admin-auth`; `getClientContext`, `buildProspectContext` from `@/lib/sawyer/context`; `buildSawyerSystemPrompt` from `@/lib/sawyer/prompt`; `streamSawyerTurn`, `validateFinalizePayload` from `@/lib/sawyer/chat`; `createProposal`, `updateProposal`, `getProposal`, `appendMessage`, `getMessages` from `@/lib/sawyer/store`.
- Produces: SSE stream — events `data: {token}` (text deltas), `data: {proposal:{id,public_token}}` (on finalize/save), terminal `data: [DONE]`.

- [ ] **Step 1: Write the route** (no unit test — integration-level, like the Hollis/Herald routes; verified manually in Task 12 + by typecheck)

```typescript
// app/api/admin/sawyer/chat/route.ts
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getClientContext, buildProspectContext } from "@/lib/sawyer/context";
import { buildSawyerSystemPrompt } from "@/lib/sawyer/prompt";
import { streamSawyerTurn, validateFinalizePayload } from "@/lib/sawyer/chat";
import { createProposal, updateProposal, getProposal, appendMessage, getMessages } from "@/lib/sawyer/store";
import type { ChatMessage, SawyerContext } from "@/lib/sawyer/types";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  if (!body?.message) {
    return new Response(JSON.stringify({ error: "message required" }), { status: 400 });
  }
  const { proposalId, clientId, prospect, message } = body as {
    proposalId?: string;
    clientId?: string;
    prospect?: { name: string; company?: string; notes?: string };
    message: string;
  };

  // Resolve context: existing proposal's client, an explicit clientId, or a prospect.
  let ctx: SawyerContext | null = null;
  let resolvedClientId: string | null = null;
  let prospectName: string | null = null;
  if (clientId) {
    ctx = await getClientContext(clientId);
    resolvedClientId = clientId;
  }
  if (!ctx && prospect?.name) {
    ctx = buildProspectContext(prospect);
    prospectName = ctx.name;
  }
  if (!ctx && proposalId) {
    const existing = await getProposal(proposalId);
    if (existing?.client_id) {
      ctx = await getClientContext(existing.client_id);
      resolvedClientId = existing.client_id;
    } else if (existing) {
      ctx = buildProspectContext({ name: existing.prospect_name ?? "Prospect" });
      prospectName = existing.prospect_name;
    }
  }
  if (!ctx) {
    return new Response(JSON.stringify({ error: "client or prospect context required" }), { status: 400 });
  }

  const history: ChatMessage[] = proposalId ? await getMessages(proposalId) : [];
  const messages: ChatMessage[] = [...history, { role: "user", content: message }];
  const system = buildSawyerSystemPrompt(ctx);
  const stream = streamSawyerTurn({ system, messages });

  const encoder = new TextEncoder();
  let assistantText = "";

  const readable = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            assistantText += chunk.delta.text;
            send({ token: chunk.delta.text });
          }
        }
        const final = await stream.finalMessage();

        // Persist conversation turns under a proposal (create one on first finalize).
        let activeProposalId = proposalId ?? null;
        const toolUse = final.content.find((b) => b.type === "tool_use" && b.name === "finalize_proposal");
        if (toolUse && toolUse.type === "tool_use") {
          const v = validateFinalizePayload(toolUse.input);
          if (v.ok) {
            if (activeProposalId) {
              const saved = await updateProposal(activeProposalId, { title: v.title, sections: v.sections, pricing: v.pricing });
              send({ proposal: { id: saved.id, public_token: saved.public_token } });
            } else {
              const saved = await createProposal({
                client_id: resolvedClientId,
                prospect_name: prospectName,
                title: v.title,
                sections: v.sections,
                pricing: v.pricing,
                created_by: guard.user.email,
              });
              activeProposalId = saved.id;
              send({ proposal: { id: saved.id, public_token: saved.public_token } });
            }
          } else {
            send({ warning: `Draft not saved: ${v.error}` });
          }
        }
        if (activeProposalId) {
          await appendMessage(activeProposalId, "user", message);
          if (assistantText) await appendMessage(activeProposalId, "assistant", assistantText);
        }
        send("[DONE]");
      } catch (err) {
        console.error("[sawyer] stream error:", err);
        send({ error: "Stream error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean. (Confirm the SSE `[DONE]` is sent as a bare string so the client reads `data: "[DONE]"`; the client in Task 11 handles both `[DONE]` forms.)

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/sawyer/chat/route.ts
git commit -m "feat(sawyer): SSE chat route with finalize + persistence"
```

---

### Task 9: Proposals CRUD + clients-search routes

**Files:**
- Create: `app/api/admin/sawyer/proposals/route.ts` (GET list, POST create-empty)
- Create: `app/api/admin/sawyer/proposals/[id]/route.ts` (GET, PATCH)
- Create: `app/api/admin/sawyer/clients/route.ts` (GET search)

**Interfaces:**
- Consumes: `requireAdmin`; `listProposals`, `getProposal`, `updateProposal`, `createProposal` from store; `searchClients` from context.
- Produces: JSON REST endpoints.

- [ ] **Step 1: Write the list/create route**

```typescript
// app/api/admin/sawyer/proposals/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listProposals, createProposal } from "@/lib/sawyer/store";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  return NextResponse.json({ proposals: await listProposals() });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const body = await req.json().catch(() => ({}));
  const proposal = await createProposal({
    client_id: body.clientId ?? null,
    prospect_name: body.prospectName ?? null,
    title: body.title ?? "Untitled proposal",
    sections: [],
    pricing: null,
    created_by: guard.user.email,
  });
  return NextResponse.json({ proposal });
}
```

- [ ] **Step 2: Write the single-proposal route**

```typescript
// app/api/admin/sawyer/proposals/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getProposal, updateProposal } from "@/lib/sawyer/store";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const proposal = await getProposal(id);
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ proposal });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const proposal = await updateProposal(id, {
    title: body.title,
    status: body.status,
    sections: body.sections,
    pricing: body.pricing,
  });
  return NextResponse.json({ proposal });
}
```

- [ ] **Step 3: Write the clients-search route**

```typescript
// app/api/admin/sawyer/clients/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { searchClients } from "@/lib/sawyer/context";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ clients: await searchClients(q) });
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean. (Note: Next 16 route handlers take `params` as a Promise — already reflected above; verify against `node_modules/next/dist/docs/` if the signature errors.)

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/sawyer/proposals app/api/admin/sawyer/clients
git commit -m "feat(sawyer): proposals CRUD + client search routes"
```

---

### Task 10: PDF route + public proposal page

**Files:**
- Create: `app/api/admin/sawyer/proposals/[id]/pdf/route.ts`
- Create: `app/proposals/[token]/page.tsx`
- Modify: `proxy.ts` (allow `/proposals/*` to bypass portal/admin gating) — verify current matcher first.

**Interfaces:**
- Consumes: `getProposal`, `getProposalByToken`, `markViewed` from store; `renderProposalPdf`, `renderProposalHtml` from render; `requireAdmin`.

- [ ] **Step 1: Write the PDF route**

```typescript
// app/api/admin/sawyer/proposals/[id]/pdf/route.ts
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getProposal } from "@/lib/sawyer/store";
import { renderProposalPdf } from "@/lib/sawyer/render";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const proposal = await getProposal(id);
  if (!proposal) return new Response("Not found", { status: 404 });
  const pdf = await renderProposalPdf(proposal);
  const safe = proposal.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safe}.pdf"`,
    },
  });
}
```

- [ ] **Step 2: Write the public page**

```tsx
// app/proposals/[token]/page.tsx
import { getProposalByToken, markViewed } from "@/lib/sawyer/store";
import { renderProposalHtml } from "@/lib/sawyer/render";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PublicProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const proposal = await getProposalByToken(token);
  if (!proposal) notFound();
  await markViewed(token);
  const html = renderProposalHtml(proposal);
  // The rendered HTML is a full branded document built from escaped fields.
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
```

- [ ] **Step 3: Check + update `proxy.ts` matcher**

Run: `grep -n "matcher\|proposals\|onboarding" proxy.ts`
If portal/admin gating would intercept `/proposals/:token`, add an exclusion so the public page is reachable unauthenticated. Mirror however `journeys`/public routes are already excluded. Expected edit: ensure `/proposals/(.*)` is NOT gated.

- [ ] **Step 4: Typecheck + manual PDF smoke**

Run: `npm run typecheck` (expect clean).
Manual (after Task 12 wiring / or via a quick script): create a proposal row, hit `/api/admin/sawyer/proposals/<id>/pdf`, confirm a valid PDF downloads; open `/proposals/<token>` and confirm the branded page renders and `viewed_at` stamps.

- [ ] **Step 5: Commit**

```bash
git add "app/api/admin/sawyer/proposals/[id]/pdf" "app/proposals/[token]" proxy.ts
git commit -m "feat(sawyer): PDF export route + public token proposal page"
```

---

### Task 11: Admin UI — Sawyer chat + proposals list

**Files:**
- Create: `app/(admin)/agents/sawyer/page.tsx` (server shell)
- Create: `app/(admin)/agents/sawyer/SawyerConsole.tsx` (client component — chat + list)

**Interfaces:**
- Consumes: the routes from Tasks 8–10.

- [ ] **Step 1: Write the server shell**

```tsx
// app/(admin)/agents/sawyer/page.tsx
import SawyerConsole from "./SawyerConsole";

export default function SawyerPage() {
  return <SawyerConsole />;
}
```

- [ ] **Step 2: Write the client console**

```tsx
// app/(admin)/agents/sawyer/SawyerConsole.tsx
"use client";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };
type ProposalRow = { id: string; title: string; status: string; client_id: string | null; prospect_name: string | null; public_token: string; updated_at: string };
type ClientRow = { id: string; name: string; company: string };

export default function SawyerConsole() {
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientQuery, setClientQuery] = useState("");
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const refresh = () => fetch("/api/admin/sawyer/proposals").then((r) => r.json()).then((d) => setProposals(d.proposals ?? []));
  useEffect(() => { refresh(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/admin/sawyer/clients?q=${encodeURIComponent(clientQuery)}`).then((r) => r.json()).then((d) => setClients(d.clients ?? []));
    }, 200);
    return () => clearTimeout(t);
  }, [clientQuery]);

  async function send() {
    if (!input.trim() || streaming) return;
    const userMsg = input.trim();
    setMessages((m) => [...m, { role: "user", content: userMsg }, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    const res = await fetch("/api/admin/sawyer/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: activeId, clientId, message: userMsg }),
    });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]" || payload === '"[DONE]"') continue;
        try {
          const obj = JSON.parse(payload);
          if (obj.token) setMessages((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: c[c.length - 1].content + obj.token }; return c; });
          if (obj.proposal) { setActiveId(obj.proposal.id); setActiveToken(obj.proposal.public_token); refresh(); }
        } catch { /* ignore keepalive */ }
      }
    }
    setStreaming(false);
  }

  function openProposal(p: ProposalRow) {
    setActiveId(p.id); setActiveToken(p.public_token); setClientId(p.client_id);
    fetch(`/api/admin/sawyer/proposals/${p.id}`).then((r) => r.json()).then(() => setMessages([]));
  }
  function newProposal() { setActiveId(null); setActiveToken(null); setMessages([]); setClientId(null); }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, height: "calc(100vh - 120px)" }}>
      <aside style={{ borderRight: "1px solid #e6e6e6", paddingRight: 12, overflowY: "auto" }}>
        <button onClick={newProposal} style={{ width: "100%", padding: 8, marginBottom: 12 }}>+ New proposal</button>
        <input placeholder="Search clients…" value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} style={{ width: "100%", padding: 6, marginBottom: 8 }} />
        {clients.map((c) => (
          <div key={c.id} onClick={() => setClientId(c.id)} style={{ padding: 6, cursor: "pointer", background: clientId === c.id ? "#f0f0f0" : "transparent", borderRadius: 6 }}>
            {c.company || c.name}
          </div>
        ))}
        <h4 style={{ marginTop: 16 }}>Proposals</h4>
        {proposals.map((p) => (
          <div key={p.id} onClick={() => openProposal(p)} style={{ padding: 6, cursor: "pointer", fontWeight: activeId === p.id ? 700 : 400 }}>
            {p.title} <span style={{ color: "#888", fontSize: 12 }}>· {p.status}</span>
          </div>
        ))}
      </aside>
      <main style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 12 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ margin: "8px 0", textAlign: m.role === "user" ? "right" : "left" }}>
              <span style={{ display: "inline-block", padding: "8px 12px", borderRadius: 10, background: m.role === "user" ? "#1a1a1a" : "#f3f3f3", color: m.role === "user" ? "#fff" : "#1a1a1a", whiteSpace: "pre-wrap", maxWidth: "80%" }}>{m.content || "…"}</span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        {activeToken && (
          <div style={{ display: "flex", gap: 8, padding: "8px 0", fontSize: 14 }}>
            <button onClick={() => navigator.clipboard.writeText(`${location.origin}/proposals/${activeToken}`)}>Copy link</button>
            <a href={`/api/admin/sawyer/proposals/${activeId}/pdf`} target="_blank" rel="noreferrer">Download PDF</a>
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={clientId ? "Describe the deal…" : "Pick a client first (or just describe a prospect)…"} style={{ flex: 1, padding: 10 }} disabled={streaming} />
          <button onClick={send} disabled={streaming}>{streaming ? "…" : "Send"}</button>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + manual check**

Run: `npm run typecheck` (expect clean). Then `npm run dev`, sign in as admin, open `/agents/sawyer`, pick a client, ask for a Hollis proposal, confirm streaming + that a proposal appears in the list with a working Copy link / Download PDF.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/agents/sawyer"
git commit -m "feat(sawyer): admin chat console + proposals list UI"
```

---

### Task 12: Manifest entry + rail wiring + full-suite green

**Files:**
- Modify: `app/(admin)/agents/agents-manifest.ts` (add Sawyer to `AGENTS`, group `growth`)

**Interfaces:**
- Consumes: `AgentManifestEntry` shape.

- [ ] **Step 1: Add the manifest entry**

In `app/(admin)/agents/agents-manifest.ts`, in the `// ── Growth ──` block (after `avery` / `june`), add:

```typescript
  { slug: "sawyer", name: "Sawyer", tagline: "Proposals", glyph: "✎", group: "growth",
    description: "Drafts formal, send-ready client proposals from a chat. Knows GB2G's products, rate card, and voice, and pulls the target client's live account data. Exports a branded shareable link and a PDF. Upstream of Vera (contracts)." },
```

- [ ] **Step 2: Verify the rail renders Sawyer**

Run: `npm run dev`, open `/agents`, confirm a Sawyer card appears in the Growth group and links to `/agents/sawyer`.

- [ ] **Step 3: Full suite + typecheck (serial, repo convention)**

Run: `node --import tsx --test --test-concurrency=1 'lib/**/*.test.ts'`
Expected: all green (existing suite + the new Sawyer tests).
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/agents/agents-manifest.ts"
git commit -m "feat(sawyer): register in agents manifest (growth group)"
```

---

## Operator steps (post-merge)

1. `supabase db push` to apply `030_proposals.sql`.
2. Confirm `ANTHROPIC_API_KEY` is set in the deploy env (already used fleet-wide — no new secret).
3. Confirm `/proposals/:token` is publicly reachable (proxy matcher) and that admin routes 403 for non-admins.
4. Smoke: draft a real proposal for an existing client, send yourself the link, download the PDF.

---

## Self-Review

**Spec coverage:**
- §2 naming/placement → Tasks 11–12. ✅
- §3 architecture → Tasks 2–11 mirror the diagram. ✅
- §4 module table (`types`/`company`/`context`/`prompt`/`chat`/`render`/`store`) → Tasks 1–7. ✅
- §5 data model (both tables, token, viewed_at) → Task 1; `markViewed` Task 4 + Task 10. ✅
- §6 rate-card pricing + `pricing.source` enforcement → company Task 2, prompt Task 5, `validateFinalizePayload` Task 6. ✅
- §7 link + PDF → Tasks 7 + 10. ✅
- §8 routes table → Tasks 8–10. ✅
- §9 admin UI → Task 11. ✅
- §10 model/caching → Task 6 (`SAWYER_MODEL`); prompt caching is a follow-up optimization, not blocking (noted, not silently dropped). ⚠️ deferred-by-design.
- §11 testing → every lib task ships tests; routes verified by typecheck + manual smoke (matches Hollis convention). ✅
- §13 seams (manifest, proxy) → Tasks 12, 10. ✅

**Placeholder scan:** No TBD/TODO in implementation steps. The only "to confirm" strings are intentional runtime output for `needs_confirmation` pricing.

**Type consistency:** `ProposalSection {key,heading,body}`, `ProposalPricing {source,items,summary}`, `PricingLineItem {label,amount,cadence,note}` used identically across `types`/`store`/`chat`/`render`. `validateFinalizePayload` returns `{title,sections,pricing}` consumed verbatim by the chat route. `generateToken`/`public_token` consistent across store + page. `getProposalByToken`/`markViewed` names consistent Tasks 4/10.

**One deferred item (flagged, not dropped):** system-prompt prompt caching (§10) is a cost optimization left for a follow-up; functionality is complete without it.
