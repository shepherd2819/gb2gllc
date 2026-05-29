# Otis — Billing Dunning Agent

- **Date:** 2026-05-29
- **Status:** Approved, ready for implementation plan
- **Author:** John (jmccully@8brands.com), design partnered with Claude

## Summary

Otis is an **internal** billing-dunning agent that chases overdue Stripe invoices. Real-time payment-status sync via a Stripe webhook keeps our `invoices` table in lockstep with Stripe; a daily cron walks past-due invoices and sends graduated reminder emails on a 3 / 7 / 14 / 21 days-past-due cadence; at day 30 the agent stops and pings you in Slack. Static templates in GB2G voice, signed off as "Otis at GB2G." Code lives under `lib/billing/` (functional path); the persona name shows up in user-facing copy only.

## Design notes (why this shape)

### Why Stripe-status as the trigger
We set `days_until_due: 14` on every invoice, so Stripe's own `past_due` transition is the right anchor — it already reflects "due date has passed without payment." Building our own threshold (X days from `sent_at`) would duplicate Stripe's lifecycle and drift any time we changed `days_until_due`. Tying to Stripe means the agent reacts to Stripe's truth.

### Why webhook + daily cron (Approach C)
- **Webhook** keeps `invoices.status` and `paid_at` in lockstep with Stripe in real time. If a client pays mid-day, the next morning's cron won't re-send a reminder for a paid invoice — the table already shows `paid`.
- **Daily cron** is the right granularity for sending. Dunning is a day-level decision (was the threshold crossed *today*?), not real-time. One cron pass at 13:00 UTC (matches `chatbot-digest`/`reese-draft` cadence).
- Considered cron-poll Stripe for status sync (matches Iris/Wren pattern, no new infra). Rejected because real-time sync materially reduces the "paid invoice got dunned" embarrassment risk, and webhook is a one-time Stripe Dashboard setup.

### Why static templates (not Claude-drafted)
Dunning emails are sensitive but predictable. The four templates are hand-written in GB2G voice and pre-approved; auto-send is a scheduled merge, not a fresh judgment call. Templates also eliminate LLM tone drift on money conversations.

### Why auto-send all four
The "review every reminder" friction of Iris/Wren doesn't earn its keep when the content is hand-written templates John already approved. The day-30 escalation is the explicit stop — Otis never sends after that; John takes over.

---

## Workstream 1 — Real-time payment sync

### Webhook endpoint: `app/api/stripe/webhook/route.ts`

**Auth:** `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`. Unsigned or wrong-signature requests return 400.

**Events handled** (other events 200-OK with no-op):
- `invoice.finalized` → status='open'
- `invoice.payment_failed` → status='past_due' (if not already)
- `invoice.paid` → status='paid', `paid_at=event.created_at`
- `invoice.voided` → status='voided', `voided_at=now`
- `invoice.marked_uncollectible` → status='uncollectible'

All five handlers also set `status_synced_at=now`, and **backfill `due_date` and `invoice_link` (hosted_invoice_url) from `event.data.object` if those columns are NULL on our row**. This lets the agent safely cover invoices that were created before the webhook existed — they self-backfill the first time Stripe sends an event about them. New invoices will pick up `due_date` + `invoice_link` on the `invoice.finalized` event the moment they're created+sent.

**Idempotency:** skip the update if `invoices.status_synced_at >= event.created_at`. Prevents stale events from out-of-order retries (Stripe will retry up to ~3 days). The backfill step still runs on idempotent events so old NULL columns get populated even if the status didn't change.

**Unknown invoices:** if `event.data.object.id` isn't in our `invoices` table, log a warning and 200-OK (the invoice may have been created outside our flow — don't blow up the webhook).

### Library: `lib/billing/stripe-events.ts`

Pure(-ish) event router. Exports `routeStripeEvent(event)` that takes a parsed `Stripe.Event` and returns an `UpdatePlan` describing the column changes — then the webhook route applies the update. Tests assert event-to-plan mapping without touching Supabase.

---

## Workstream 2 — Dunning sender

### Daily cron: `app/api/cron/dunning-send/route.ts`

**Schedule:** `0 13 * * *` (13:00 UTC = 9am ET in winter, 8am ET in summer). Same cadence as `chatbot-digest`. Bearer-auth with `CRON_SECRET`.

**Loop:**
1. Fetch invoices `WHERE status = 'past_due' AND escalated_at IS NULL AND paused_at IS NULL AND due_date IS NOT NULL`. (The `due_date IS NOT NULL` guard skips legacy rows whose backfill hasn't happened yet — they'll be picked up on the next Stripe event.)
2. Join `client_dunning_settings` and skip rows where `paused_until > NOW()`.
3. For each, compute `days_past_due = NOW - due_date`.
4. Determine tier via `lib/billing/dunning.ts::determineTier(daysPastDue)`:

   | Days past due | Tier |
   |---|---|
   | 3–6   | 1 (warm) |
   | 7–13  | 2 (firmer) |
   | 14–20 | 3 (firm) |
   | 21–29 | 4 (final) |
   | 30+   | escalate |
5. If tier ∈ {1,2,3,4} and `reminder_count < tier`: render template, send via Resend, update `reminder_count=tier`, `last_reminder_sent_at=now`, `last_reminder_tier=tier`.
6. If escalate and `escalated_at IS NULL`: post Slack to `SUPPORT_SLACK_CHANNEL`, set `escalated_at=now`.
7. Return JSON `{ ok, summary: {scanned, sent, escalated, errors}, results: [...] }`.

### Library: `lib/billing/dunning.ts`

Pure logic where possible:
- `determineTier(daysPastDue: number): 1 | 2 | 3 | 4 | 'escalate' | null` — `null` for `daysPastDue < 3`
- `renderTemplate(tier: 1 | 2 | 3 | 4, merge: MergeFields): { subject: string; body: string }`
- `sendReminder(invoice, tier)` — composes merge fields, calls `renderTemplate`, sends via Resend, returns `{ resend_id, error? }`
- `postEscalationSlack(invoice, client)` — composes Block Kit message via `lib/slack-builders.ts`, calls `postSlackMessage` with `SUPPORT_SLACK_CHANNEL` + `SLACK_ADMIN_BOT_TOKEN`

### Library: `lib/billing/templates.ts`

Plain-text email templates with merge fields. Subject and body are exported as constants per tier:

**Tier 1 — Warm (day 3):**
```
Subject: Quick note about invoice for {description}

Hi {first_name} —

Quick check: the invoice for {description} ({amount}) was due a few days ago. Here's the link in case it slipped your inbox:

{invoice_link}

If something's off — wrong amount, wrong contact, anything — just reply and we'll sort it.

— Otis at GB2G
```

**Tier 2 — Firmer (day 7):**
```
Subject: Following up — invoice for {description}

Hi {first_name} —

Following up on the invoice for {description} ({amount}), now {days_past_due} days past due.

The payment link is still live:

{invoice_link}

If there's a delay or a question on your end, let us know — happy to work it out.

— Otis at GB2G
```

**Tier 3 — Firm (day 14):**
```
Subject: Invoice for {description} — now {days_past_due} days past due

Hi {first_name} —

The invoice for {description} ({amount}) is now {days_past_due} days past due. We'd really appreciate getting this settled this week.

{invoice_link}

If there's something we should know about, please reach out — we'd rather work it out than let it slide further.

— Otis at GB2G
```

**Tier 4 — Final (day 21):**
```
Subject: Final reminder — invoice for {description}

Hi {first_name} —

A final note: the invoice for {description} ({amount}) is now {days_past_due} days past due. If there's a problem we should know about, please reach out today.

{invoice_link}

After this we'll pause auto-reminders and John will follow up personally.

— Otis at GB2G
```

The "Speak to Support" CTA footer (from `lib/email-footer.ts`) is appended to every reminder body before the signature, matching Herald-digest/Wren practice.

**Escalation (day 30, internal Slack only — never sent to client):**
```
*Invoice escalation needed*
*Client:* {client.name} ({client.company})
*Invoice:* {description} — {amount}
*Days past due:* {days_past_due}
*Last reminder sent:* Tier {N} on {date}

Auto-reminders stopped. [Open in admin]({admin_url}/billing#invoice-{id})
```

### Merge fields

```ts
type MergeFields = {
  first_name: string;        // derived from client.name; falls back to "there"
  description: string;       // invoices.description; falls back to "GB2G Services"
  amount: string;            // formatted like "$2,400.00"
  days_past_due: number;
  invoice_link: string;      // Stripe hosted_invoice_url (cached from webhook)
};
```

---

## Data model — migration `021_billing_dunning.sql`

```sql
-- ============================================================
-- 021_billing_dunning.sql — Otis (billing dunning agent)
-- ============================================================
-- Extends the existing invoices table with dunning state, adds a
-- per-client pause-settings table, and introduces a partial index for
-- the daily dunning sweep.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS due_date              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_synced_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reminder_tier    INTEGER,
  ADD COLUMN IF NOT EXISTS reminder_count        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paused_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paused_reason         TEXT,
  ADD COLUMN IF NOT EXISTS escalated_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_link          TEXT,
  ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Existing status column has DEFAULT 'draft' with no CHECK. We add a
-- CHECK constraint reflecting Stripe's invoice lifecycle.
ALTER TABLE invoices
  ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('draft','sent','open','past_due','paid','uncollectible','voided'));

-- Partial index drives the daily dunning sweep efficiently.
CREATE INDEX idx_invoices_dunning_eligible
  ON invoices(status, due_date)
  WHERE status = 'past_due'
    AND escalated_at IS NULL
    AND paused_at IS NULL
    AND due_date IS NOT NULL;

CREATE TABLE client_dunning_settings (
  client_id      UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  paused_until   TIMESTAMPTZ,
  paused_reason  TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE client_dunning_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON client_dunning_settings FOR ALL USING (false);
```

Notes:
- `invoice_link` caches Stripe's `hosted_invoice_url` from the `invoice.finalized` event so the daily cron doesn't have to hit the Stripe API for every send.
- `updated_at` added to `invoices` (it was missing — useful for audit and "modified-since" queries).
- The status CHECK uses Stripe's lifecycle terms; the existing values in production (`draft`, `sent`) are preserved.

---

## Workstream 3 — Admin UI

### Extending `/billing`

Add a top section above the existing "Send invoice" + "Invoice history" two-column layout:

**Dunning queue** — server-rendered, grouped by tier:
- **Eligible today:** invoices that *would* receive a reminder on the next cron pass (`status='past_due'`, not paused/escalated, days_past_due in {3, 7, 14, 21}).
- **Sent recently:** invoices that received a reminder in the last 24h.
- **Escalated:** `escalated_at IS NOT NULL`, sorted by escalation date desc.
- **Paused:** `paused_at IS NOT NULL` OR a per-client pause is active.

Each row: client name + company · description · amount · `{days_past_due}d` · last reminder badge (e.g. `T2 · 5d ago`) · action cluster.

Actions per row:
- `[Pause]` — sets `invoices.paused_at = now()`, prompts for `paused_reason`
- `[Pause client]` — opens a small modal setting `client_dunning_settings.paused_until` (default 30 days)
- `[Send now]` — manually triggers the next tier ahead of cron (useful for testing or special cases)
- `[Resume]` — clears `paused_at` (only shown on paused rows)

### API routes
- `PATCH /api/admin/billing/dunning/[invoiceId]/pause` — body `{ paused: boolean, reason?: string }`
- `PATCH /api/admin/billing/dunning/client/[clientId]/pause` — body `{ paused_until: ISO | null, reason?: string }`
- `POST /api/admin/billing/dunning/[invoiceId]/send-now` — triggers `sendReminder` for the next tier
- All `requireAdmin`-gated.

---

## Guardrails

- **Webhook signature:** every request goes through `stripe.webhooks.constructEvent` — fail closed on signature mismatch
- **Idempotency:** webhook handler skips updates older than `status_synced_at`
- **CRON_SECRET:** Bearer-auth on the dunning cron
- **Don't double-send:** `reminder_count` gates each tier; only one reminder per tier ever sent
- **Pause respects both layers:** per-invoice `paused_at` AND `client_dunning_settings.paused_until > NOW()` both block
- **Escalation is terminal:** once `escalated_at` is set, Otis never sends to the client again — only John
- **Skip non-payable invoices:** `paid`, `voided`, `uncollectible`, `draft`, `sent` (not yet finalized) all skipped
- **`logEvent` category:** `"billing"` (will need adding to the `lib/logger.ts` Category union as part of implementation — same pattern as Wren/Holt)
- **RLS:** `client_dunning_settings` service-role-only

---

## Out of v1 (YAGNI)

- Event-sourced `dunning_log` table — use `reminder_count`/`last_reminder_tier` counters on `invoices`. If we need full per-send history later, add the table then.
- Per-client cadence overrides — one cadence for all clients. A "VIP cadence" is easy to add later by joining `client_dunning_settings`.
- Client-facing portal payment surface — Stripe's hosted invoice URL is fine for v1.
- Auto-voiding after N days — manual `Mark uncollectible` button in admin if needed.
- Subscriptions/recurring invoices — we only have one-off invoices today.
- Multi-currency — all USD; the amount formatter assumes `$`.
- Custom template copy in the admin UI — templates are TypeScript constants for v1. Adding an `invoice_templates` table is easy if needed later.

---

## Testing

- `node:test` unit tests for pure logic:
  - `determineTier` — boundary cases at 2/3/6/7/13/14/20/21/29/30
  - `renderTemplate` — all 4 tiers, merge-field substitution, missing-name fallback
  - `routeStripeEvent` — maps each handled event to the correct `UpdatePlan`; unknown events are no-ops
  - Slack escalation block builder
- I/O paths (Stripe webhook, Resend, Supabase) verified manually + `tsc --noEmit` clean

---

## Environment variables

**New:**
- `STRIPE_WEBHOOK_SECRET` — Stripe-supplied signing secret for the webhook endpoint. Set in Vercel after creating the endpoint in the Stripe Dashboard.

**Reused (no changes):** `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `RESEND_FROM`, `CRON_SECRET`, `NEXT_PUBLIC_HOME_URL`, `NEXT_PUBLIC_ADMIN_URL`, `SUPPORT_SLACK_CHANNEL`, `SLACK_ADMIN_BOT_TOKEN`.

---

## Suggested build sequence

1. Migration `021_billing_dunning.sql`.
2. `lib/billing/templates.ts` + `lib/billing/dunning.ts` (pure logic, TDD).
3. `lib/billing/stripe-events.ts` event router + tests.
4. `app/api/stripe/webhook/route.ts`.
5. `app/api/cron/dunning-send/route.ts` + register in `vercel.json`.
6. `lib/logger.ts` — add `"billing"` to the Category union.
7. Admin API routes (pause / send-now).
8. Admin UI: extend `/billing` with `DunningQueue.tsx`.
9. Manual ops: `supabase db push`, create Stripe webhook endpoint, set `STRIPE_WEBHOOK_SECRET`, disable Stripe's built-in reminder emails.
10. Smoke test: `stripe trigger invoice.payment_failed` against test mode.

---

## Phase X — manual operational tasks (you only)

1. `supabase db push` to apply `021_billing_dunning.sql`.
2. **Stripe Dashboard → Developers → Webhooks → Add endpoint:**
   - URL: `https://admin.gb2gllc.com/api/stripe/webhook`
   - Events: `invoice.finalized`, `invoice.payment_failed`, `invoice.paid`, `invoice.voided`, `invoice.marked_uncollectible`
   - Copy the signing secret.
3. `STRIPE_WEBHOOK_SECRET=<paste>` in Vercel env, redeploy.
4. **Stripe Dashboard → Settings → Invoicing → Reminder schedule:** *disable* Stripe's automatic reminder emails so they don't duplicate Otis's.
5. Smoke test: with Stripe CLI, `stripe listen --forward-to https://admin.gb2gllc.com/api/stripe/webhook` then `stripe trigger invoice.payment_failed` and watch `invoices.status_synced_at` flip.

---

## Open questions

None — every fork is locked:
- Trigger anchor = Stripe `past_due`
- Cadence = 3 / 7 / 14 / 21 days past due, escalate at 30
- Content = static templates, GB2G voice, sign-off "Otis at GB2G"
- Auto-send = yes for tiers 1–4; never for escalation
- Sync = Stripe webhook (real-time) + daily dunning cron
- Admin UI = extend `/billing` with `DunningQueue.tsx`; pause per-invoice + per-client; manual send-now
- Slack = reuse `SUPPORT_SLACK_CHANNEL` + `SLACK_ADMIN_BOT_TOKEN`
