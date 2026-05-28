# Wren — Support Mailbox Triage Agent

- **Date:** 2026-05-28
- **Status:** Approved, ready for implementation plan
- **Author:** John (jmccully@8brands.com), design partnered with Claude

## Summary

Three independent workstreams shipped together in one PR:

1. **Wren** — a Gmail support-mailbox triage agent (sibling to Iris). Classifies, drafts replies, and surfaces them in an admin inbox for approval. Iris stays scoped to the founder's personal inbox; Wren handles `support@gb2gllc.com`.
2. **"Speak to Support" CTA** — a shared email-footer helper applied to client-facing system emails (Herald digest, Wren replies, invites, announcements). Drives clients to the existing portal `/tickets` form.
3. **Portal-tickets admin surface** — Slack notification on ticket create + a basic `/support` admin list and detail page, closing the gap where tickets land silently in the DB today.

The three are decoupled by design: Wren handles inbound email; the portal handles in-app submissions; the CTA links the two channels for clients without entangling the agent.

## Design notes (why this shape)

### Why decoupled from portal tickets
An earlier draft coupled portal ticket creation, Wren triage, and Gmail reply threading into one pipeline (Resend out, Gmail in, token threading). That over-built: portal tickets and email triage are genuinely separate channels, and the threading complexity (tokens in subject, Gmail dedup, `ticket_messages` table) wasn't paying for itself. Decoupling drops the `ticket_messages` table, the Resend↔Gmail token scheme, and the on-ticket-create triage trigger.

### Why a sibling agent (not extending Iris)
Iris is the founder's personal-inbox agent. Wren is the support team's inbox agent. Both use Gmail-poll + classify + draft, but their personas, classification taxonomies, and (eventually) productization paths differ. Sibling agents:
- Let Wren's classifier specialize (support-tuned categories vs. Iris's general-inbox categories)
- Avoid growing Iris with `account_type` branching complexity
- Keep Wren cleanly productizable later as a client-facing offering
- Cost near-nothing because the shared Gmail/OAuth machinery moves to `lib/gmail.ts` (small refactor)

### Why Slack for portal notification
`lib/slack.ts` is already wired (Maya/Mark/Steward use it). Considered email-to-admin via Resend; chose to keep Slack after weighing alternatives.

---

## Workstream 1 — Wren

### Behavior (the loop)

1. Cron (~every 2 min) polls `support@gb2gllc.com` Gmail for new inbox messages.
2. Each new message is parsed, deduped (`UNIQUE(account_id, gmail_message_id)`), and inserted into `wren_messages`.
3. Each is classified with Claude Haiku into one of: `bug`, `feature_request`, `account_help`, `billing_question`, `general`, `spam`. Priority: `high` / `med` / `low`.
4. Before classify, the sender's `from_email` is matched against `clients.email`. If a hit, the matched client's `{name, company, active products, recent client_logs summary}` is hydrated and passed to the classifier as warm context.
5. The classified message is labeled in Gmail as `Wren/{category}` via `getOrCreateLabel` + `addLabelToMessage`, so `support@` stays browsable in the Gmail UI alongside the admin queue (mirrors Iris's `Iris/{category}` labeling).
6. If the category is in the configured `draft_categories` AND a reply is warranted, the classifier writes a `draft_reply` (plain text, GB2G voice), which is saved as a Gmail draft in the original thread via `createGmailDraft`.
7. Hostile / legal / refund / ambiguous messages produce no draft and are flagged `Founder must reply personally`.
8. Admin reviews the queue at `/agents/wren`, edits/approves the draft, clicks **Send** → `sendGmailDraft` promotes it to a real send (Gmail keeps the thread).
9. **Never auto-sends. No exceptions.**

### Components (new code under `lib/wren/`)

- `classify.ts` — Haiku classifier+drafter, support-tuned. Same JSON shape and robust parsing as `lib/iris/classify.ts`; different system prompt and category set. Appends `supportFooterText()` then signature when assembling the final draft body.
- `poll.ts` — per-account poller. Same shape as `lib/iris/poll.ts`. Uses the shared `lib/gmail.ts` helpers.
- `anchor.ts` — exports `findClientForSender(fromEmail: string)` returning `{id, name, company, active_products, recent_logs_summary} | null`. Called from `poll.ts` before classify; result passed to `classifyAndDraft`.

Reused unchanged: `lib/anthropic.ts`, `lib/logger.ts`, `lib/admin-auth.ts`, `lib/resend.ts` (footer is consumed elsewhere).

Shared (after refactor — see below): `lib/gmail.ts`.

### Data model — new migration `019_wren.sql`

Mirrors `018_iris_inbox.sql` with renamed tables, support-tuned category set, and one added column (`matched_client_id`).

```
wren_inbox_accounts (
  id UUID PK,
  workos_user_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'gmail' CHECK (provider IN ('gmail')),
  email_address TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT,
  history_id TEXT,
  last_polled_at TIMESTAMPTZ,
  last_poll_error TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workos_user_id, email_address)
)

wren_messages (
  id UUID PK,
  account_id UUID NOT NULL REFERENCES wren_inbox_accounts(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  gmail_thread_id TEXT NOT NULL,
  from_email TEXT, from_name TEXT,
  to_addresses TEXT[] NOT NULL DEFAULT '{}',
  delivered_to TEXT,
  subject TEXT, snippet TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  body_text TEXT, body_html TEXT, body_purged_at TIMESTAMPTZ,
  category TEXT,    -- bug | feature_request | account_help | billing_question | general | spam
  priority TEXT,    -- high | med | low
  reasoning TEXT,
  suggested_action TEXT,
  draft_reply TEXT,
  matched_client_id UUID REFERENCES clients(id),
  classified_at TIMESTAMPTZ, classify_model TEXT, classify_error TEXT,
  gmail_draft_id TEXT, gmail_label_id TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','classified','sent','archived','flagged')),
  sent_at TIMESTAMPTZ, archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, gmail_message_id)
)

wren_settings (
  account_id UUID PK REFERENCES wren_inbox_accounts(id) ON DELETE CASCADE,
  draft_categories TEXT[] NOT NULL DEFAULT
    ARRAY['bug','feature_request','account_help','billing_question','general']::TEXT[],
  ignore_from_patterns TEXT[] NOT NULL DEFAULT
    ARRAY['noreply@','no-reply@','donotreply@','mailer-daemon@']::TEXT[],
  voice_notes TEXT,
  signature TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

Indexes mirror Iris's (`account_id, received_at DESC`; `account_id, status, received_at DESC`; `account_id, category, received_at DESC`; pending-classify partial; purge-candidates partial).

RLS: `ENABLE ROW LEVEL SECURITY` + `"service role only"` policy on all three (standard codebase footer).

The only schema delta vs. Iris: `wren_messages.matched_client_id` — used by the admin UI to surface "From your client {X}" hints and to fold client context into the draft prompt.

### Triggers

- **Cron** `/api/cron/wren-poll` — every 2 min. Auth: `Authorization: Bearer ${CRON_SECRET}`. Calls `pollAllActiveAccounts()` from `lib/wren/poll.ts`.
- **Cron** `/api/cron/wren-purge` — daily. Nullifies `body_text`/`body_html` and stamps `body_purged_at` for messages older than 30 days where `body_purged_at IS NULL`.
- **Manual reclassify** — admin button → `POST /api/admin/wren/messages/[id]/reclassify`.
- **Send** — admin button → `POST /api/admin/wren/messages/[id]/send` → `sendGmailDraft`, then `status='sent'`, `sent_at=now()`.

Both crons registered in `vercel.json`.

### Admin UI

URLs are under the `(admin)` route group, which doesn't add to the URL:

- `app/(admin)/agents/wren/page.tsx` → `/agents/wren` — accounts list (server component). Shows the connected support mailbox(es) with last-poll status. "Connect mailbox" button → `/api/wren/oauth/start`.
- `app/(admin)/agents/wren/[id]/page.tsx` → `/agents/wren/[id]` — inbox view for a single account (mirrors `IrisInbox.tsx`). Lists `wren_messages` ordered by `received_at DESC`. Each row: category + priority chips, sender, subject, snippet, draft preview. Expands to thread + editable draft + **Send / Edit / Re-draft / Archive / Flag**.
- Admin nav (`app/(admin)/layout.tsx`) gets a new link: **Wren** → `/agents/wren`.

UI follows codebase conventions: no Tailwind, server components by default with thin client components for interactivity, classes from `public/admin/admin.css`, CSS tokens preserved.

### API routes

```
app/api/wren/oauth/start/route.ts                       GET   — initiate Google OAuth (state cookie + redirect)
app/api/wren/oauth/callback/route.ts                    GET   — exchange code, upsert wren_inbox_accounts
app/api/admin/wren/accounts/[id]/poll/route.ts          POST  — manual poll trigger (requireAdmin)
app/api/admin/wren/accounts/[id]/settings/route.ts      GET/PATCH — read/update wren_settings (requireAdmin)
app/api/admin/wren/messages/[id]/route.ts               GET   — message detail (requireAdmin)
app/api/admin/wren/messages/[id]/reclassify/route.ts    POST  — re-run classification (requireAdmin)
app/api/admin/wren/messages/[id]/send/route.ts          POST  — promote draft → real send via Gmail (requireAdmin)
app/api/cron/wren-poll/route.ts                         GET   — cron entry (Bearer auth)
app/api/cron/wren-purge/route.ts                        GET   — cron entry (Bearer auth)
```

### Refactor: `lib/iris/google.ts` → `lib/gmail.ts`

Every function in `lib/iris/google.ts` is a Gmail/OAuth helper that Wren needs too. Move it to `lib/gmail.ts` with two surface changes:

1. **Parameterize the redirect URI.** Currently hardcoded as `${ADMIN_URL}/api/iris/oauth/callback`. Change `googleInstallUrl(state)` → `googleInstallUrl({ state, redirectUri })` and `exchangeGoogleCode(code)` → `exchangeGoogleCode({ code, redirectUri })`. Iris's OAuth routes and Wren's new OAuth routes each pass their own `redirectUri`.
2. **Update Iris's imports.** `lib/iris/poll.ts` and Iris's OAuth route files change `from "./google"` → `from "@/lib/gmail"`.

Behavior unchanged. `tsc --noEmit` clean after.

### Classifier prompt shape

- **Identity:** "You are Wren, a support-mailbox triage agent for GB2GLLC."
- **Category list (verbatim in prompt):** `bug, feature_request, account_help, billing_question, general, spam`.
- **Priority rubric:** high = same-day reply needed; med = within a few days; low = wait / no reply needed. (Same shape as Iris.)
- **Draft rules:** plain text, no markdown, GB2G voice (warm/direct, no exclamation points unless sender used them), no invented commitments / pricing / links, 2–5 sentences, escalate hostile/legal/refund (empty draft + `suggested_action: "Founder must reply personally"`). No signature in the model's output — appended by code.
- **Warm context block** (when `matched_client_id` is present): inject `{client.name, client.company, active_products[], recent_logs_summary}` so the draft can reference what they have with us.
- **Output:** JSON only, same `Classification` shape as Iris's (`category, priority, reasoning, suggested_action, draft_reply`).

---

## Workstream 2 — "Speak to Support" CTA

### Helper — `lib/email-footer.ts`

```
export function supportFooterHtml(): string;
export function supportFooterText(): string;
```

- `supportFooterHtml()` — HTML block: a thin rule + small paragraph with a button-styled link **"Speak to Support →"** pointing to `${NEXT_PUBLIC_HOME_URL}/tickets`. Styling matches `lib/email-templates/herald-digest.ts` (Inter/Garamond, parchment/ink palette).
- `supportFooterText()` — plain-text equivalent for Gmail drafts:
  ```
  —
  Need help? Open a ticket: {NEXT_PUBLIC_HOME_URL}/tickets
  ```

### Application sites (opt-in)

Each template that should include the CTA calls the helper. Apply to:

- `lib/email-templates/herald-digest.ts` — append `supportFooterHtml()` before the closing `</body>`.
- `lib/wren/classify.ts` — when assembling the final draft body: `{draft body}\n\n{supportFooterText()}\n\n{signature}`. (The footer goes *between* draft and signature.)
- Any future client-bound system email (invites, announcements, etc.).

Explicitly NOT applied:

- `lib/avery/send.ts` — cold outreach to prospects.
- `lib/iris/poll.ts` / Iris drafts — founder's personal-inbox replies.

---

## Workstream 3 — Portal-tickets admin surface

### Notification

`app/api/portal/tickets/route.ts` — after the successful insert, fire a Slack notification via `lib/slack.ts`, wrapped in `after()` so the POST returns instantly to the portal client.

Notification payload (Block Kit):

```
{
  "text": "New support ticket: {subject}",
  "blocks": [
    { "type": "section", "text": { "type": "mrkdwn", "text": "*New ticket from {client.name} ({client.company})*" }},
    { "type": "section", "text": { "type": "mrkdwn", "text": "*{subject}*\n{body first 200 chars}…" }},
    { "type": "actions", "elements": [{ "type": "button", "text": { "type": "plain_text", "text": "Open in admin" }, "url": "{ADMIN_URL}/support/{id}" }]}
  ]
}
```

Target: new env var `SUPPORT_SLACK_CHANNEL` (channel ID). If unset, the notification call is a no-op + `logEvent` warning (so non-prod doesn't crash).

### Admin pages

URLs under `(admin)` route group. Naming: **Support** (not "Tickets") to avoid colliding with the existing portal `/tickets` URL and to reinforce the "Speak to Support" CTA brand.

- `app/(admin)/support/page.tsx` → `/support` — server component. Lists all tickets across all clients, ordered by `created_at DESC`. Columns: **Client** (name + company), **Subject**, **Status** badge, **Created**. Filter chip: "Open only" (default on). Row click → `/support/[id]`.
- `app/(admin)/support/[id]/page.tsx` → `/support/[id]` — full ticket view: client header (name, email, company), subject, body, status, timestamps. Actions: **Mark resolved** button.
- Admin nav (`app/(admin)/layout.tsx`) gets a new link: **Support** → `/support`.

### API

- `app/api/admin/support/[id]/route.ts` PATCH — guarded by `requireAdmin`. Body: `{ status: 'open' | 'in_progress' | 'resolved' }`. On `resolved`, also sets `resolved_at = NOW()`.

No `tickets` schema changes.

### Proxy matcher update

`proxy.ts` `config.matcher` currently includes `/agents/:path*` (covers Wren) but does not include `/support`. Add `"/support/:path*"` so admin authkit middleware runs on these routes.

---

## Guardrails (cross-cutting)

- **Never auto-send.** Wren drafts always require a human click.
- **Escalation.** Hostile / legal / refund / ambiguous → no draft, `suggested_action = "Founder must reply personally"`. Mirrors Iris.
- **Failure handling.** Classify/send failures: `logEvent` + persist error on the row; never thrown from trigger/cron. Retry path: admin Re-classify button.
- **Inbound dedup.** `UNIQUE(account_id, gmail_message_id)` on `wren_messages`; insert ignores Postgres `23505`.
- **Body retention.** `body_text`/`body_html` purged after 30 days via `/api/cron/wren-purge`. Headers + classification kept indefinitely for search.
- **Admin authorization.** Every `/admin/*` page and `/api/admin/*` route checks `requireAdmin` (single `ADMIN_EMAIL`).
- **Cron authorization.** Every `/api/cron/*` checks `Authorization: Bearer ${CRON_SECRET}`.
- **RLS.** All new tables: service-role-only.

## Out of v1 (YAGNI)

- Email-created NEW portal tickets (emailing `support@` goes to Wren only; portal tickets only come from the portal form).
- Past-tickets / FAQ KB context in Wren's drafts (v1 = `{ticket + matched client account}`).
- Client-facing portal thread UI for tickets (clients see status only; agent replies happen via email).
- Tying Wren replies back to a portal ticket (if a client emails AND submits a portal ticket about the same issue, they're separate trails).
- Multiple support mailboxes (one `support@` for v1; the data model supports many, just unused).
- Multi-tenant Wren (productizing for clients to deploy on their own mailboxes — that's a future Steward preset).

## Testing approach

The repo has no test runner installed. Plan:

- Add Node's built-in `node:test` (no new deps) and a `"test"` script in `package.json`.
- Unit tests for pure logic:
  - `lib/wren/classify.ts` — JSON parse/normalize, sign-off stripping, escalation defaults (mirror Iris's robustness checks).
  - `lib/email-footer.ts` — helper output for HTML and text variants.
  - The Slack message builder for portal-ticket notifications.
- I/O paths (Gmail, Resend, Anthropic, Slack, Supabase) verified manually + `tsc --noEmit` clean.

## Environment variables

**New:**
- `SUPPORT_SLACK_CHANNEL` — Slack channel ID for portal-ticket notifications. If unset, notification is no-op + warning.

**Reused (no changes):** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM`, `SLACK_*` (per `lib/slack.ts`), `CRON_SECRET`, `NEXT_PUBLIC_HOME_URL`, `NEXT_PUBLIC_ADMIN_URL`, `ADMIN_EMAIL`.

## Suggested build sequence

1. Refactor `lib/iris/google.ts` → `lib/gmail.ts` (parameterize redirect URI). Verify Iris still works (`tsc --noEmit` + manual poll).
2. Migration `019_wren.sql`.
3. `lib/wren/{classify,anchor,poll}.ts` + Wren OAuth routes (`/api/wren/oauth/{start,callback}`).
4. `/api/cron/wren-poll` + `/api/cron/wren-purge`; register both in `vercel.json`.
5. Admin Wren UI (`/agents/wren` list + `/agents/wren/[id]` detail).
6. `lib/email-footer.ts`; apply to Herald digest and Wren draft assembly.
7. Slack notification on portal-ticket create (`app/api/portal/tickets/route.ts`).
8. Admin Support pages (`/support` list + `/support/[id]` detail + PATCH route).
9. Add nav links **Wren** and **Support** in `AdminLayout`; add `/support/:path*` to `proxy.ts` matcher.
10. Unit tests for pure logic.
11. Connect `support@gb2gllc.com` via Wren OAuth (one-time admin action).
12. Set `SUPPORT_SLACK_CHANNEL` in Vercel env.

## Open questions

None — all decisions made during brainstorming:

- Wren is a **sibling** agent (not an Iris extension, not a Steward preset).
- Draft context = ticket + matched client account (no past tickets, no KB).
- Wren outbound = Gmail draft promotion (not Resend).
- CTA scope = client-facing emails (excludes Avery, Iris drafts).
- Portal notification = Slack (kept after considering email alternative).
- Portal admin surface = `/support` list + detail with **Mark resolved**.
- Test approach = `node:test` for pure logic + manual / `tsc` for I/O.
