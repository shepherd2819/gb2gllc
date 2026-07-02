# Herald-Only Custom Intake Link

- **Date:** 2026-06-04
- **Status:** Approved, ready for implementation plan
- **Author:** John (jmccully@8brands.com), design partnered with Claude

## Summary

A dedicated, reusable intake link for prospects who are signing up for **Herald only** (the website chatbot product). One URL John can paste into emails, the site, or a DM.

- John shares one reusable link: **`gb2gllc.com/intake/herald`**.
- The prospect lands on a **Herald-branded, slimmed intake** — not the generic 40-platform stack form — that collects exactly what's needed to stand up their chatbot.
- On finish, the flow is **fully hands-off**: a `clients` row is created/updated, the **Herald product is auto-enabled** (`client_products`), the prospect's chosen **agent name** is written to the client, and a **WorkOS portal invite** is sent automatically.
- The submission appears in `/submissions` flagged **"Herald,"** and a read-only **Herald setup answers** panel on the submission detail page lets John copy the prospect's answers straight into HeraldManager when he builds the bot.
- The only manual step left for John is dropping the chatbot **Bot ID** into HeraldManager once the bot is built.

The link is **public** (same access model as today's intake) and **reusable** (one link for every Herald prospect, forever).

## Design notes (why this shape)

### Why a dedicated Herald form instead of reusing the generic intake
The generic intake collects a 9-step, product-agnostic picture (goals, a 40+ platform software-stack grid, per-platform access grants). Almost none of that applies to Herald, which is a website chat widget: it needs the prospect's **website**, the **content the bot should know**, its **voice/name**, and a **lead/escalation path** — not OAuth grants to Slack/Stripe/etc. A tailored, shorter form gets John exactly the inputs that configure Herald and respects the prospect's time.

### Why dedicated files, not a parameterized engine (build approach A)
The generic intake (`public/intake.html` + `intake-app.js` + `intake-platforms.js`) is **live and in use**. Adding a "herald mode" branch inside the large shared `intake-app.js` would put the working flow at regression risk. Because the Herald form is genuinely simpler (fewer, different stages), a purpose-built `intake-herald.html` + `intake-herald-app.js` is a small, well-bounded unit — not a heavy clone — and leaves the generic intake untouched. It stays vanilla JS, consistent with the project's "no React refactor / no UI libs" brand rules, and reuses the **existing server endpoints** (`/api/intake/new`, `GET|PATCH /api/intake/[sessionId]`, `/uploads`, `/submit`) unchanged in shape, so the autosave/upload/submit contracts are shared even though the UI code is separate.

Rejected alternatives: **(B)** parameterize the live engine — more DRY but risks the working intake; **(C)** rebuild as a React/Next page — violates brand rules and diverges from the established intake pattern.

### Why the product signal is a column on `intake_sessions`
The "this is a Herald signup" signal must survive from link → session → submission → client. The cleanest carrier is a first-class, queryable column `intake_sessions.intended_product` (nullable TEXT), set when the session is minted. This is decoupled from the URL format, visible to admin, and reusable if other product-specific links (Atrium, Steward) are ever added. The existing `source` column stays semantically "where it came from" (`source='herald-link'`); `intended_product` carries "what they're buying" (`'herald'`).

### Why fully hands-off (auto-create + auto-enable + auto-invite)
John chose to minimize manual steps. Today, generic `submit` already auto-creates a `clients` row (no product, no invite); the admin `convert` action sends the invite. For the Herald link, `submit` itself performs the full automation so a completed Herald intake needs no admin action to grant portal access and turn Herald on. The tradeoff — a public link that auto-sends invites — is accepted, mitigated by guards (below).

### Guards on the hands-off invite
Because the link is public, the auto-invite is guarded so it can't be abused into a re-invite loop or fire on junk:
- Require a non-empty, syntactically valid `contact.email` before creating a client or inviting.
- **Idempotent invite:** only call WorkOS `sendInvitation` when the client has no `invited_at` yet; set `invited_at` on success. Resubmits and duplicate emails (the client already exists) do not re-invite.
- `submit` is already idempotent on `submitted_at` (early-returns if already submitted), so a double POST can't double-fire.
- Product enablement (`client_products` upsert) is idempotent via `onConflict (client_id, product)`.

### Why the agent name maps to `chatbot_agent_name`
Herald's per-client config already has a `chatbot_agent_name` column (falls back to "Herald" when null, shown on the client dashboard and in digest emails). The Herald form's "agent name" answer maps directly onto it at submit, so the prospect's chosen name shows up immediately without John re-typing it. The remaining Herald answers (website, bot knowledge, FAQs, escalation) live in session `state`, are written to the Notion page, and are surfaced on the submission detail page for John to use when building the bot.

### Out of scope (future)
- **AI braindump for Herald.** The generic braindump uses a generic extraction schema (contact/about/goals/software/tasks) that doesn't match Herald's fields. A Herald-shaped braindump is a later enhancement; v1 is structured stages only.
- **Per-prospect tokenized links.** John chose one reusable link. The contract-style `[token]` pattern (`app/sign/[token]`) is available if single-use/trackable Herald links are ever wanted.
- **A `custom` product type.** `"custom"` exists in `lib/vera/product-scopes.ts` but is absent from the DB `CHECK` and admin UI, so it isn't persistable today. This feature maps strictly to `herald` and does not touch that gap.
- **Honeypot/captcha spam guard.** Easy to add later if the public auto-invite attracts abuse; not in v1.

---

## Behavior (the loops)

### Start loop (prospect-triggered, public)
1. Prospect opens **`gb2gllc.com/intake/herald`** → `app/intake/herald/page.tsx`.
2. The page POSTs `/api/intake/new` with `{ source: "herald-link", intendedProduct: "herald" }`.
3. `/api/intake/new` mints `sessionId = "sess_" + …`, stores `source`, `intended_product = "herald"`, empty `state`, 30-day expiry. Returns `{ sessionId, resumeUrl }`.
4. The page redirects to **`/intake/{sessionId}`**.
5. `app/intake/[sessionId]/route.ts` loads the session, checks expiry, reads `intended_product`. Because it's `"herald"`, it serves **`public/intake-herald.html`** and injects `window.GB2G_SESSION_ID`, `window.GB2G_CALENDLY_URL`, and `window.GB2G_INTAKE_MODE = "herald"`. (Any other / null `intended_product` → unchanged generic `public/intake.html`.)
6. `intake-herald.html` loads `intake-herald-app.js`, which renders the Herald stage sequence and autosaves/uploads via the existing endpoints.

### Fill loop (prospect-triggered)
The Herald form is a structured sequence (no braindump path, no software-stack grid):
1. **Welcome / contact** — name, email, company.
2. **Your website** — URL · platform (Squarespace / WordPress / Shopify / Wix / custom / other) · who can add a code snippet.
3. **What your assistant should know** — products/services · top FAQs · hours · key policies (free-text + structured prompts).
4. **Brand voice + agent name** — agent display name (what visitors see) · tone (friendly / professional / playful) · words/topics to avoid.
5. **Leads & escalation** — where hot leads / unanswered questions go (email / SMS / Slack) · who handles them · optional booking link to offer visitors.
6. **Docs (SOPs)** — upload FAQ docs / price sheets / help-center links (reuses `/uploads` + pasted links).
7. **Book a kickoff call** — Calendly iframe (reuses `GB2G_CALENDLY_URL`).
8. **Done** — confirmation; calls `submit`.

State is held in `localStorage` and PATCH-synced (debounced) to `intake_sessions.state` under a `state.herald.*` namespace plus the standard `state.contact`.

### Finish loop (prospect-triggered, hands-off)
On the Done stage, `intake-herald-app.js` POSTs **`/api/intake/[sessionId]/submit`**. The enhanced handler:
1. Loads the session; if `submitted_at` already set, early-returns (idempotent).
2. Creates the Notion page (unchanged) and marks `submitted_at` + `notion_page_id`.
3. If `state.contact.email` is present and valid:
   a. Upsert `clients` (as today) **and resolve `clientId`** using the `ignoreDuplicates` → re-fetch fallback already proven in `convert/route.ts`.
   b. If the session's `intended_product === "herald"`:
      - Upsert `client_products { client_id, product: "herald", active: true }` (`onConflict: "client_id,product"`).
      - If `state.herald.agentName` is set and the client's `chatbot_agent_name` is null, set `chatbot_agent_name`.
      - If the client has no `invited_at`, send WorkOS `sendInvitation({ email })` and set `invited_at = now()`. (Guarded, idempotent.)
   c. Log to `client_logs` with category `"intake"` (and/or `"herald"`).
4. Returns `{ ok, notionPageId, clientId, heraldEnabled, invited }`.

### Admin parity (admin-triggered)
`POST /api/admin/submissions/[id]/convert` gets the **same** Herald product-assignment block (read `intended_product`, upsert `client_products`, map agent name), so a manually converted Herald submission is identical to an auto-completed one. The invite logic there is unchanged (convert already sends one).

---

## Data model

### Migration `027_intake_intended_product.sql`
```sql
ALTER TABLE intake_sessions
  ADD COLUMN IF NOT EXISTS intended_product TEXT;

COMMENT ON COLUMN intake_sessions.intended_product IS
  'Product this intake link is scoped to (e.g. "herald"); drives the tailored form + auto product-enable on submit. NULL = generic intake.';
```
No CHECK constraint (kept open for future product links; values are written only by trusted server code). RLS is inherited from the existing `intake_sessions` policies (service-role only) — no policy change. Existing rows get `NULL`, which the serve route treats as the generic flow.

### Touched tables (no schema change beyond the column)
- `intake_sessions` — new `intended_product` column; `state.herald.*` JSONB sub-tree holds the Herald answers.
- `clients` — `chatbot_agent_name` set from the form; `invited_at` set by the guarded invite (both columns already exist).
- `client_products` — a `herald` row upserted active.
- `client_logs` — audit entries (category `intake`/`herald`).

## Files

**New**
- `supabase/migrations/027_intake_intended_product.sql`
- `app/intake/herald/page.tsx` — mints a Herald-tagged session, redirects to `/intake/{sessionId}`.
- `public/intake-herald.html` — Herald-branded shell, reusing existing intake CSS tokens/styling.
- `public/intake-herald-app.js` — the Herald stage state machine (autosave, upload, submit via existing endpoints).

**Modified**
- `app/api/intake/new/route.ts` — accept + store `intendedProduct`.
- `app/intake/[sessionId]/route.ts` — read `intended_product`; serve `intake-herald.html` + inject `GB2G_INTAKE_MODE` when `"herald"`; else unchanged.
- `app/api/intake/[sessionId]/submit/route.ts` — resolve `clientId`; Herald product-enable + agent-name map + guarded WorkOS invite; logging.
- `app/api/admin/submissions/[id]/convert/route.ts` — same Herald product-assignment block for parity.
- `app/(admin)/submissions/[id]/page.tsx` — read-only **Herald setup answers** panel + a "Herald" flag/badge when `intended_product === "herald"`.
- (If the submissions list shows tags) `app/(admin)/submissions/page.tsx` — surface the Herald flag in the list.
- `lib/notion.ts` (`createIntakePage`) — ensure the Herald answers are included on the Notion page (extend only if it doesn't already serialize full `state`).

## Error handling
- **Session minting fails** (`/intake/herald`) → render the existing "Something went wrong starting your intake" fallback, matching `app/intake/page.tsx`.
- **Expired/invalid session** on serve → existing 404 HTML ("link is invalid or has expired").
- **Notion page failure** at submit → logged, non-fatal (as today); the client/Herald/invite automation still proceeds (it is gated on `email`, not on Notion).
- **WorkOS invite failure** (e.g., already invited) → caught and logged, non-fatal (mirrors `convert`); `invited_at` only set on success so a later retry can still invite.
- **Missing/invalid email** at submit → skip client creation + invite, still record the submission; surfaced in admin so John can follow up manually.
- **No `intended_product`** (generic session hitting the same endpoints) → all Herald-specific steps are skipped; generic behavior preserved.

## Testing
- **Migration** applies cleanly; existing sessions read back `intended_product = NULL`.
- **Serve routing:** a `herald` session serves `intake-herald.html` with `GB2G_INTAKE_MODE="herald"`; a generic session still serves `intake.html`.
- **Start → fill → submit (happy path):** completing the Herald form creates a client, a `client_products(herald, active)` row, sets `chatbot_agent_name`, sends exactly one invite, sets `invited_at`.
- **Idempotency:** resubmitting / a second prospect reusing the link with the same email does not create a duplicate invite or duplicate product row; `submit` early-returns once `submitted_at` is set.
- **Guards:** submitting with a blank/invalid email creates no client and sends no invite; submission still recorded.
- **Admin parity:** converting a Herald submission from `/submissions` yields the same product/agent-name result as the auto path.
- **Regression:** the generic `/intake` flow is byte-for-byte unchanged (no edits to `intake.html`/`intake-app.js`).
- **Per AGENTS.md:** read `node_modules/next/dist/docs/01-app/…` (route handlers, proxy, layouts/params) before writing route code; honor async `params`/`searchParams` and `proxy.ts` (not middleware).
