# Sawyer — Proposal Composer agent (design spec)

**Date:** 2026-06-29
**Status:** Approved design, pre-implementation
**Owner:** John (john@gb2gllc.com)
**Branch target:** `feat/sawyer-proposals` (off `main`)

---

## 1. Purpose

An admin-only chat agent in the GB2G portal that drafts **formal, export-ready client proposals**. John describes a client and a deal in chat; Sawyer — grounded in (a) canonical GB2G company knowledge and (b) the **live** Supabase record of the target client — drafts a complete proposal, refines it conversationally, and exports it as a **shareable branded web link** and a **PDF**.

Sawyer sits upstream of Vera: Sawyer produces the *proposal*; once accepted, Vera (contracts) takes over. Sawyer never generates contracts.

### Success criteria
- From a standing start, John can produce a send-ready proposal for a real client in under ~3 minutes of chat.
- Proposals are consistent with GB2G's real rate card and voice without John re-typing boilerplate.
- Every proposal is persisted, re-openable, and exportable to link + PDF.
- Pricing is never silently invented off-strategy (rate-card-driven, see §6).

### Non-goals (YAGNI)
- Not client-facing/self-serve — admin (John) only.
- No e-signature, payment, or contract generation (that's Vera/Stripe).
- No CRM pipeline/stage management.
- No multi-user collaboration or comment threads on a proposal.
- No analytics on proposal views in v1 (a `viewed_at` stamp is the only telemetry).

---

## 2. Naming & placement

- **Name:** Sawyer. Human first-name, consistent with the fleet (Iris, Wren, Holt, Nora, Vera, Avery, June, Mark, Hollis, Maya). Distinct from Vera (contracts).
- **Group:** `growth` in `agents-manifest.ts` (it's a sales/deal tool).
- **Admin surface:** `app/(admin)/agents/sawyer/` — a chat panel + saved-proposals list, following the Agents-hub conventions (`agents/layout.tsx` rail, manifest entry, glyph).
- **Auth:** `requireAdmin()` on every API route (email-gated to `ADMIN_EMAIL`). The public proposal link (§7) is the only un-gated surface and is protected by an unguessable token.

---

## 3. Architecture overview

```
┌─ app/(admin)/agents/sawyer/page.tsx ──────────────────────────────┐
│  Chat panel (SSE) + client picker + saved-proposals list           │
└───────────────┬───────────────────────────────────┬───────────────┘
                │ POST /api/admin/sawyer/chat (SSE)   │ CRUD /api/admin/sawyer/proposals
                ▼                                     ▼
        lib/sawyer/chat.ts  ──uses──►  lib/sawyer/company.ts  (canonical GB2G knowledge)
                │                       lib/sawyer/context.ts  (LIVE client data from Supabase)
                │                       lib/sawyer/prompt.ts   (system prompt assembly)
                │ finalize_proposal tool
                ▼
        lib/sawyer/store.ts  ──►  Supabase: proposals, proposal_messages
                │
                ▼
        lib/sawyer/render.tsx  ──►  branded HTML (link) + PDF (@react-pdf/renderer)

Public read-only:  app/proposals/[token]/page.tsx   (token-gated microsite)
PDF:               GET /api/admin/sawyer/proposals/[id]/pdf
```

Mirrors the existing in-house Herald SSE chat (`app/api/herald/route.ts`) and the `lib/hollis/` module layout.

---

## 4. Module: `lib/sawyer/`

| File | Responsibility | Depends on |
|---|---|---|
| `types.ts` | `Proposal`, `ProposalSection`, `ProposalStatus` (`draft`/`sent`/`accepted`/`declined`), `RateCardItem`, `ChatMessage`. | — |
| `company.ts` | **The "knows us" layer.** Canonical GB2G facts as typed constants: identity/voice (faith-rooted, ops-first, plain-spoken, no hype, no scripture in product context), product catalog + rate card (Herald $2,400/mo, Atrium $18,000/site, Steward [Q2 2026], **Hollis voice-AI $1,500–$5,000/mo managed tiers**), differentiators, boilerplate terms (NDA: yes; clients keep all code & data; etc.). Single source of truth, reused by `prompt.ts`. Consolidates what's today scattered across `public/about.html` and `lib/anthropic.ts` prompt copy. | `types.ts` |
| `context.ts` | **The "live" layer.** `getClientContext(clientId)` reads Supabase: `clients`, `client_products`, `client_members` (count/roles), Hollis config if present (`hollis_lines`), recent `tickets` summary. Returns a compact, **typed** context object — never raw rows — to keep messy data out of prose. Also `searchClients(query)` for the picker and a `ProspectContext` shape for "new prospect" (manual name/company/notes, no DB row). | `@/lib/supabase`, `types.ts` |
| `prompt.ts` | `buildSawyerSystemPrompt(company, clientContext)` → system prompt: identity + voice + rate card + the live client context + the required proposal section structure + the rule that pricing must come from the rate card (override only on explicit instruction). | `company.ts`, `context.ts` |
| `chat.ts` | The streaming Anthropic loop. Model `claude-sonnet-4-6`. Multi-turn (`messages[]`), streams text via SSE, and exposes a single `finalize_proposal` **tool** (`strict`-style structured input) that captures the proposal as ordered sections + a `pricing` block. When the tool fires, the structured payload is returned to the route for persistence. | `@anthropic-ai/sdk`, `prompt.ts` |
| `render.tsx` | `renderProposalHtml(proposal)` → branded HTML for the public link; `renderProposalPdf(proposal)` → React-PDF document. Shared section ordering/branding so link and PDF match. | `@react-pdf/renderer`, `types.ts` |
| `store.ts` | `createProposal`, `getProposal`, `getProposalByToken`, `listProposals`, `updateProposal` (sections/status/title), `appendMessage`, `getMessages`. Idempotent token generation. | `@/lib/supabase`, `types.ts` |

### Proposal section model
Default ordered sections (the model may add/merge as the deal warrants, but defaults to):
1. **Cover** — client name, prepared-for/by, date, proposal title.
2. **About GB2G** — short, voiced intro (from `company.ts`).
3. **Understanding your needs** — synthesized from chat + live client context.
4. **Proposed solution / scope & deliverables** — the product(s), what's included.
5. **Pricing** — tier + figure(s) from the rate card; structured `pricing` block (line items, term, total/monthly).
6. **Timeline & next steps.**
7. **Terms** — boilerplate (ownership, NDA, etc.).

---

## 5. Data model — migration `030_proposals.sql`

```sql
create table proposals (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references clients(id) on delete set null,  -- null = ad-hoc prospect
  prospect_name text,                                            -- used when client_id is null
  title         text not null,
  status        text not null default 'draft'
                  check (status in ('draft','sent','accepted','declined')),
  sections      jsonb not null default '[]'::jsonb,              -- ordered ProposalSection[]
  pricing       jsonb,                                           -- structured pricing block
  markdown      text,                                            -- flattened source (search/export)
  public_token  text unique not null,                            -- unguessable; powers /proposals/[token]
  viewed_at     timestamptz,                                     -- first public view
  created_by    text not null,                                   -- admin email
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

RLS: tables are written/read only via `supabaseAdmin` (service role) behind `requireAdmin`; the public page reads a single row by `public_token` via a narrow server-side query (service role, token-scoped). No anon-key access.

---

## 6. Pricing logic (decision: rate-card-driven)

- `company.ts` holds the real rate card as typed `RateCardItem[]`.
- The system prompt instructs Sawyer to **select the right tier and use its real numbers**, and to **state assumptions** (e.g. "Hollis Growth tier, 12-month term").
- John can override any figure conversationally ("make it $3,500") — the override flows into the `pricing` block.
- Sawyer must **never invent a figure absent from the rate card without flagging it** as a custom quote needing John's confirmation. This is enforced in the prompt and reinforced by the `finalize_proposal` tool requiring a `pricing.source` of `rate_card` | `custom_override` | `needs_confirmation`.

---

## 7. Exports

### Shareable link
- `app/proposals/[token]/page.tsx` — server component, reads the proposal by `public_token` (service role, token-scoped), renders `renderProposalHtml`. Branded, read-only, no admin chrome. Stamps `viewed_at` on first load.
- Token: 32+ chars, URL-safe random, unique. Unguessable acts as the access control (same posture as the Hollis demo token approach).

### PDF
- `GET /api/admin/sawyer/proposals/[id]/pdf` — `requireAdmin`, builds the React-PDF document via `renderProposalPdf`, returns `application/pdf`. Uses the already-installed `@react-pdf/renderer`.

Link and PDF share `render` section ordering and branding so they're visually consistent.

---

## 8. API routes (all `requireAdmin` except the public page)

| Route | Method | Purpose |
|---|---|---|
| `/api/admin/sawyer/chat` | POST (SSE) | Stream a turn. Body: `{ proposalId?, clientId?|prospect, messages[] }`. Streams text deltas; on `finalize_proposal` tool-use, persists sections+pricing and emits a `proposal` SSE event with the saved id. |
| `/api/admin/sawyer/proposals` | GET / POST | List / create proposals. |
| `/api/admin/sawyer/proposals/[id]` | GET / PATCH | Fetch one / update (title, sections, status). |
| `/api/admin/sawyer/proposals/[id]/pdf` | GET | PDF export. |
| `/api/admin/sawyer/clients?q=` | GET | Client picker search (`searchClients`). |
| `/proposals/[token]` | GET (page) | Public read-only proposal. |

SSE stream shape matches the Herald route: `data: {token}` deltas, a terminal `data: [DONE]`, plus a `data: {proposal:{id}}` event when a draft is finalized/saved.

---

## 9. Admin UI — `app/(admin)/agents/sawyer/page.tsx`

- **Left:** saved-proposals list (title, client, status chip, updated date) + "New proposal".
- **Center:** chat transcript (streaming), composer.
- **Top of chat:** client picker (search live clients, or "New prospect" with manual fields).
- **Right/inline actions on a finalized draft:** Preview (renders sections), Copy link, Download PDF, status selector (draft→sent→accepted/declined).
- Follows existing agent-page styling; reuse `components/ui/` ds-* components where they fit.
- Manifest entry added to `AGENTS` (group `growth`, glyph e.g. `✎`).

---

## 10. Model & cost

- Model: `claude-sonnet-4-6` (generative quality tier, consistent with Holt/Avery/intake). Not Haiku.
- `max_tokens`: ~2048 for chat turns; finalize tool-use may run larger.
- Prompt caching on the system prompt (company knowledge is stable) to cut cost on multi-turn refinement.
- Per-admin rate limiting is unnecessary (single admin) but the route still guards with `requireAdmin`.

---

## 11. Testing strategy

Pure, Retell-style "build the libs first, they're fully testable" approach:
- `company.ts` — rate card integrity (every product has a price or explicit "custom"/"launching" status).
- `context.ts` — `getClientContext` shapes (mock Supabase): client with/without products, with/without Hollis, prospect shape; never leaks raw rows.
- `prompt.ts` — system prompt includes identity, rate card, live context, and the pricing-source rule; snapshot-style assertions.
- `store.ts` — CRUD + unique token generation + idempotency (mock Supabase).
- `render.tsx` — HTML/PDF section ordering & that pricing block renders from structured data, not prose.
- `chat.ts` — `finalize_proposal` tool payload validation (rejects pricing with no `source`).
- Route-level: `requireAdmin` rejection paths; SSE happy path with a mocked Anthropic stream.

Target: full suite stays green run serially (`--test-concurrency=1`), typecheck clean — matching repo convention.

---

## 12. Build sequence (for the plan)

1. Migration `030_proposals.sql` + `types.ts`.
2. `company.ts` (rate card + identity) + tests.
3. `context.ts` (live client retrieval) + tests.
4. `store.ts` + tests.
5. `prompt.ts` + tests.
6. `chat.ts` (Anthropic loop + finalize tool) + tests.
7. `render.tsx` (HTML + PDF) + tests.
8. API routes (chat SSE, proposals CRUD, pdf, clients search).
9. Public `/proposals/[token]` page.
10. Admin `app/(admin)/agents/sawyer/` UI + manifest entry + rail wiring.
11. Operator notes: `supabase db push` (030); confirm `ANTHROPIC_API_KEY` present (already used fleet-wide).

---

## 13. Integration seams touched

- `app/(admin)/agents/agents-manifest.ts` — add Sawyer entry (group `growth`).
- Agents rail/layout — Sawyer card appears automatically from the manifest.
- `proxy.ts` matcher — add `/proposals/[token]` if the public route needs to bypass portal/admin gating (verify against current matcher).
- No changes to existing agents, onboarding, or Hollis.

---

## 14. Open items (none blocking)

- Glyph choice for the rail (default `✎`).
- Whether "declined" proposals stay listed or archive (default: stay, filterable later — YAGNI now).
