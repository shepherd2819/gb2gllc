# Onboard — Enterprise-Grade Client Onboarding

- **Date:** 2026-06-26
- **Status:** Draft, for review
- **Author:** John (john@gb2gllc.com), design partnered with Claude
- **Discovery:** [`docs/superpowers/research/2026-06-26-enterprise-onboarding-discovery.md`](../research/2026-06-26-enterprise-onboarding-discovery.md)
- **Owner direction:** all four pillars (experience + identity + trust + automated provisioning); hybrid (self-serve + white-glove); SMB-now / enterprise-ready; #1 goal **win bigger deals**. Sequence: **A first, trust/SOC 2 track in parallel starting now.**

## Summary

**Onboard** turns GB2G's onboarding from "polished intake, then a pile of manual admin clicks" into one connected, audited, enterprise-grade journey: **sign → pay → provision (WorkOS org + products + agents) → invite → kickoff → activate → adopt.** It is **platform infrastructure** (`lib/onboarding/`) plus a light client-facing **concierge** that reuses the existing Herald SSE assistant — not a new heavy agent.

Each client gets an **onboarding journey** (a state machine) with a **shared milestone checklist** visible in their portal (`app/(portal)/onboarding`) and an admin command center (`app/(admin)/onboarding`) showing every account's stage, time-to-value (TTV), and anything stuck. The connective tissue is **Inngest**: the Vera sign route and the Stripe webhook stop doing work inline and instead emit events that drive an idempotent provisioning pipeline.

It leans hard on **WorkOS** (already paid for): one **Organization per client** is the anchor that unlocks SSO, SCIM, the self-serve Admin Portal, RBAC roles, and Audit Logs — mostly configuration, not code.

Delivered in three phases (A now; B + trust track in parallel; C last), but designed as one system so Phase A is built to fit B and C.

## Design notes (why this shape)

### Why infrastructure + a Herald-based concierge, not a 14th agent
The hard part is orchestration (sign→bill→provision→invite) and a stateful client workspace — that's platform infra, not an autonomous agent. The *client-facing* nudges ("upload your logo," "book your kickoff," "your first agent is live") are conversational, but the existing Herald SSE assistant (`app/api/herald/route.ts` + `lib/anthropic.ts`) already does in-portal chat — we reuse it with onboarding context rather than standing up a heavy new agent with its own poll/queue. Keeps the fleet lean.

### Why a journey state machine (not just a checklist)
Enterprise onboarding is phase-gated with named owners and a TTV deadline. A `clients`-column approach can't express "stage + per-step status + who owns it + due dates + audit trail." A small state machine (`onboarding_journeys` + `onboarding_milestones` + `onboarding_events`) is the minimum that supports both self-serve and white-glove, drives the portal UI, and feeds the admin TTV dashboard. `atrium_progress` (the existing build-stage checklist) is Atrium-specific and stays; Onboard generalizes the pattern.

### Why provisioning triggers on two events, not one
- On contract **`signed`**: create the WorkOS org, send the portal invite, open a **read-only** portal + the onboarding workspace. The client feels momentum immediately; no risk because nothing billable is live yet.
- On invoice **`paid`** (Stripe `invoice.payment_succeeded`): flip products **active**, provision/configure agents, mark the journey `provisioning→activated`.

This gives fast TTV without granting paid access before payment. (Owner-confirmed default.)

### Why one WorkOS Organization per client — for everyone
Organizations are the anchor for SSO, SCIM, Admin Portal, RBAC, and per-org Audit Logs. Creating one for every client (not just enterprise tier) is a few API calls and makes the whole identity layer uniform; **SSO/SCIM stay off until a client requests them** (no per-connection cost until used). Existing clients get a one-time backfill. (Owner-confirmed default.)

### Why the trust/SOC 2 track starts now, in parallel
SOC 2 Type II requires a ~6-month observation window — the start date gates your first enterprise close. It's near-zero cost to begin and runs alongside the code. Phase A already produces the audit-log substrate (`onboarding_events` + WorkOS Audit Logs) that the SOC 2 evidence needs.

### Out of scope for v1
- Replacing the intake form (it's the best part — Onboard consumes it, doesn't rebuild it).
- A bought onboarding-UX tool (Dock/Arrows) — native portal keeps it in-stack and agent-integrated.
- Usage-metered billing / a full pricing-plan engine (tiers are config; seat caps become tier-driven in B).
- Multi-region data residency (documented posture only until a deal requires it).

---

## Architecture overview

```
  Intake form (exists)  ──submit──►  client row + Notion packet + [NEW] welcome email + journey seed
                                                   │
   Vera contract  ──signed──►  emit onboarding/contract.signed (Inngest)
                                                   │
                         ┌─────────────────────────┼───────────────────────────┐
                         ▼                          ▼                           ▼
                 ensure Stripe invoice      create WorkOS Org +          seed journey + milestones,
                 (contracts.amount_cents)   send portal invite           open READ-ONLY portal
                         │
   Stripe webhook ──invoice.payment_succeeded──►  write invoices.paid_at + emit onboarding/invoice.paid
                                                   │
                                                   ▼
                                   provision.ts: activate client_products,
                                   configure agents, journey → activated,
                                   schedule kickoff, welcome-active email
                                                   │
   Portal: app/(portal)/onboarding  ◄──renders journey + milestones──►  Herald concierge nudges
   Admin:  app/(admin)/onboarding   ◄──TTV dashboard, stuck accounts, manual overrides (white-glove)
   Audit:  onboarding_events + WorkOS Audit Logs  (feeds SOC 2 evidence)
```

Every Inngest step is idempotent (keyed on client/contract/invoice id) and emits an `onboarding_events` row + a WorkOS Audit Log entry.

---

## Data model — migration `029_onboarding.sql`

(Confirm next free number with `ls supabase/migrations/`; current max is `028` (Hollis).)

```sql
-- 029_onboarding.sql — Onboard (enterprise client onboarding)
-- Journey state machine + milestones + append-only audit, plus column adds
-- that wire clients↔contracts↔billing↔WorkOS orgs↔roles.

CREATE TABLE onboarding_journeys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  template        TEXT NOT NULL DEFAULT 'standard',     -- per-product/tier playbook key
  tier            TEXT NOT NULL DEFAULT 'self_serve'
                    CHECK (tier IN ('self_serve','assisted','white_glove')),
  stage           TEXT NOT NULL DEFAULT 'invited' CHECK (stage IN (
                    'invited','kickoff_scheduled','provisioning','activated','adopted','complete','stalled'
                  )),
  owner_csm       TEXT,                                 -- GB2G owner (white-glove)
  ttv_target_at   TIMESTAMPTZ,                          -- time-to-value deadline
  activated_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE onboarding_milestones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id    UUID NOT NULL REFERENCES onboarding_journeys(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,                          -- 'sign_contract','pay_invoice','book_kickoff','upload_assets','first_agent_live'...
  title         TEXT NOT NULL,
  owner         TEXT NOT NULL DEFAULT 'client' CHECK (owner IN ('client','gb2g')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','blocked','skipped')),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  due_at        TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, key)
);

CREATE TABLE onboarding_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id    UUID REFERENCES onboarding_journeys(id) ON DELETE CASCADE,
  client_id     UUID REFERENCES clients(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,                          -- 'stage_changed','milestone_done','provisioned','invite_sent','audit'...
  actor         TEXT,                                   -- workos_user_id / 'system' / 'gb2g'
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Column adds that connect the islands (additive; safe to ship in Phase A even if used later).
ALTER TABLE clients         ADD COLUMN IF NOT EXISTS workos_org_id TEXT UNIQUE;
ALTER TABLE client_members  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'
                              CHECK (role IN ('owner','admin','member','billing','read_only'));
ALTER TABLE contracts       ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT;
-- widen client_products to match contracts (which already allows 'custom')
ALTER TABLE client_products DROP CONSTRAINT IF EXISTS client_products_product_check;
ALTER TABLE client_products ADD CONSTRAINT client_products_product_check
  CHECK (product IN ('herald','atrium','steward','custom'));

CREATE INDEX idx_onb_journeys_stage      ON onboarding_journeys(stage, updated_at DESC);
CREATE INDEX idx_onb_journeys_ttv        ON onboarding_journeys(ttv_target_at) WHERE stage NOT IN ('complete','adopted');
CREATE INDEX idx_onb_milestones_journey  ON onboarding_milestones(journey_id, sort_order);
CREATE INDEX idx_onb_events_client       ON onboarding_events(client_id, created_at DESC);

ALTER TABLE onboarding_journeys   ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_events     ENABLE ROW LEVEL SECURITY;
CREATE POLICY onb_journeys_service_role_only   ON onboarding_journeys   FOR ALL USING (false);
CREATE POLICY onb_milestones_service_role_only ON onboarding_milestones FOR ALL USING (false);
CREATE POLICY onb_events_service_role_only     ON onboarding_events     FOR ALL USING (false);
```

All access via `supabaseAdmin`, scoped by `client_id`/`journey_id` (no DB-level tenant isolation — the fleet convention).

---

## Journey state machine

```
 invited ──client books kickoff──► kickoff_scheduled ──invoice paid──► provisioning
    │                                                                       │ (products active, agents configured)
    │  (read-only portal + workspace open on contract signed)               ▼
    │                                                                   activated ──first agent does real work──► adopted ──► complete
    └────────── any stage, TTV deadline passes with no progress ──────► stalled (alerts admin; concierge nudges)
```

`stage` transitions are driven by milestone completion + Inngest events; every transition writes `onboarding_events` + a WorkOS Audit Log entry. `stalled` is recoverable (re-enters the prior stage on the next progress event).

---

## Components (new code)

```
lib/onboarding/
  journey.ts        — create/advance journey; stage transitions; TTV calc; emits events
  milestones.ts     — seed from template; complete/block; recompute stage
  templates.ts      — per-product/per-tier milestone playbooks (standard / herald / atrium / steward / enterprise)
  provision.ts      — ensure WorkOS Org, activate client_products, configure agents, send invite (all idempotent)
  audit.ts          — emit onboarding_events + WorkOS Audit Log (one helper, used everywhere)
  events.ts         — Inngest event name constants + payload types
  concierge.ts      — builds the onboarding context/system-prompt for the Herald SSE assistant
  *.test.ts         — journey transitions, milestone→stage recompute, template seeding, idempotency keys (pure parts)

lib/inngest/functions/
  onboarding-contract-signed.ts   — signed → ensure invoice + org + invite + read-only journey
  onboarding-invoice-paid.ts      — paid → activate products + agents + advance stage + welcome
  onboarding-stalled-sweep.ts     — cron/scheduled: flag journeys past TTV with no progress

app/(portal)/onboarding/
  page.tsx          — client workspace: milestone checklist, kickoff, asset uploads, status, concierge
app/(admin)/onboarding/
  page.tsx          — journey overview, TTV dashboard, stuck accounts, white-glove overrides
  [clientId]/page.tsx — single-journey detail + manual stage/milestone controls

app/api/webhooks/
  workos/route.ts    — SCIM / directory + membership events → client_members (Phase B)
  calendly/route.ts  — kickoff booked/rescheduled → milestone (consumes already-captured URIs)

app/api/admin/onboarding/...  — guarded actions: advance stage, (re)send invite, override milestone, resend welcome
```

**Modified (the seams):**
- `app/api/intake/[sessionId]/submit/route.ts` — move Notion creation to Inngest (fixes the sync-timeout risk); send a welcome email; seed a journey in `invited`.
- `app/api/sign/[token]/route.ts` — `after()` emits `onboarding/contract.signed` instead of being the end of the line.
- `app/api/stripe/webhook/route.ts` — handle `invoice.payment_succeeded`: write `invoices.paid_at`, link `contracts.stripe_invoice_id`, emit `onboarding/invoice.paid` (kept separate from Nora's AR handling).
- `app/(portal)/layout.tsx` + `lib/portal-auth.ts` — gate on `clients.status` (`disabled`/`paused` block access — closes a real security gap) and on `client_products` (sections render only for active products); read RBAC `role` (Phase B: from WorkOS JWT).
- `lib/logger.ts` — add `"onboarding"` to the `Category` union.
- `app/api/inngest/route.ts` — register the new functions.

---

## Phase A — Self-serve wizard + pipeline foundation (build now, ~2–3 wks)

The full Phase-A scope, TDD per GB2G convention:
1. Migration `029` (all tables + column adds above).
2. `lib/onboarding/` core: `journey.ts`, `milestones.ts`, `templates.ts`, `audit.ts`, `events.ts` (+ tests for the pure logic: stage recompute, template seeding, idempotency keys).
3. Inngest `onboarding-contract-signed` + `onboarding-invoice-paid` (+ register). Sign route + Stripe webhook emit events; **write `invoices.paid_at`** at last.
4. `provision.ts` Phase-A subset: activate `client_products` from the contract, send the WorkOS invite (idempotent), open the read-only portal. (WorkOS **Org create** is implemented here but org-dependent features are Phase B.)
5. Portal gating on `clients.status` + `client_products` (closes the disabled-client sign-in gap).
6. `app/(portal)/onboarding` workspace + `app/(admin)/onboarding` TTV/stuck dashboard.
7. Welcome emails (on submit + on activation); Calendly webhook → `book_kickoff` milestone.
8. Herald concierge wired with onboarding context (`concierge.ts`).
9. `onboarding-stalled-sweep` scheduled (register in `vercel.json` cron, Bearer `CRON_SECRET`).

**Phase A goal:** zero manual clicks from contract signed → client live and tracked; every client on a visible path-to-value.

## Phase B — Enterprise identity + trust (eng ~3–4 wks; non-eng starts NOW)

**Engineering:**
- WorkOS **Organization per client** fully used (`clients.workos_org_id`), incl. a one-time backfill for existing clients.
- **SSO** per org via the WorkOS **Admin Portal** (surface a scoped portal link on the client's onboarding/account page for their IT).
- **SCIM / Directory Sync** webhook (`app/api/webhooks/workos`) → upsert/deactivate `client_members`.
- **RBAC**: roles in the WorkOS session JWT; `client_members.role`; permission checks at the API layer; replace the hardcoded `MAX_TEAMMATES=1` with **tier-driven seat caps**.
- **WorkOS Audit Logs** emitted on key actions (login, role change, provisioning, data export) — `audit.ts` writes both `onboarding_events` and WorkOS.

**Non-engineering track — START IMMEDIATELY (gates enterprise close):**
- Pick **Vanta or Drata**; **start the SOC 2 Type II 6-month observation window now.**
- Publish a **DPA** (click-to-sign), a **subprocessor list** (AWS/Supabase, WorkOS, Stripe, Anthropic, Retell, Resend, Notion), **MSA + Order Form + SLA**, and a **trust center**.
- Document data **retention/deletion** (extend the existing `data-deletion` page).

## Phase C — Fully automated provisioning (~2–3 wks, after A+B)

- The complete idempotent pipeline incl. agent configuration per product (e.g. Herald chatbot setup, Hollis line provisioning hooks), `custom` product support, `contracts.stripe_invoice_id` linkage.
- Admin TTV/stuck-account dashboard hardening; `client-provisioned` event + retries; duplicate-org/invite/charge guards.
- **Goal:** zero-touch onboarding at scale; John out of the integration loop.

---

## Failure modes + idempotency (the hard part of C, designed from A)

| Case | Behavior |
|---|---|
| `contract.signed` event re-delivered | `provision.ensureOrg`/`ensureInvite` keyed on `client_id`; WorkOS org create guarded (lookup-or-create); invite guarded (re-fetch after send). |
| Stripe `invoice.payment_succeeded` duplicate | `invoices.paid_at` written with `WHERE paid_at IS NULL`; activation keyed on invoice id; benign on retry. |
| Payment before contract row exists (race) | `invoice.paid` handler waits for / re-resolves the contract by `stripe_invoice_id`; retries via Inngest. |
| WorkOS org create fails | Step retries; journey stays `invited`; admin sees it in the stuck list; never blocks the client UI. |
| Existing client (no `workos_org_id`) | Backfill job (Phase B) creates orgs; provision is lookup-or-create so it's safe meanwhile. |
| `custom` contract product | CHECK now includes `custom`; activation no longer silently drops. |
| Disabled client signs in | Portal layout gate returns them to a "contact us" state — closed before SOC 2. |
| Notion creation slow on submit | Now in Inngest, not the HTTP handler — no timeout. |
| Concierge rate limiting | Use the Supabase-backed pattern (like `hollis_demo_calls`), not the in-memory Map. |

---

## Testing

Pure logic unit-tested (Node test runner, `*.test.ts`): `journey` transitions, `milestones`→stage recompute, `templates` seeding, idempotency-key builders, the Stripe-event→action mapping. Inngest functions get smoke coverage. Manual: run a full signed→paid→activated journey against a test client; verify journey/milestones/events rows, portal gating, welcome emails, audit entries. `npm test` + `npm run typecheck` gate every step.

---

## Env vars (Vercel only)

Reuses existing `WORKOS_API_KEY`/`WORKOS_CLIENT_ID`, `STRIPE_*`, `RESEND_*`, `CRON_SECRET`, Supabase keys. New (Phase B): `WORKOS_WEBHOOK_SECRET` (SCIM webhook verify), `CALENDLY_WEBHOOK_SIGNING_KEY`. Trust track: Vanta/Drata account (non-eng).

---

## Operator tasks

- **Now (parallel with Phase A):** choose Vanta/Drata + start the SOC 2 clock; publish DPA + subprocessor list + MSA/SLA; stand up the trust center.
- After Phase A merge: `supabase db push` (`029`); set the Stripe webhook to include `invoice.payment_succeeded`; configure the Calendly webhook; register the stalled-sweep cron.
- Phase B: enable WorkOS Organizations/Directory Sync in the WorkOS dashboard; run the org backfill; set `WORKOS_WEBHOOK_SECRET`.

---

## Open decisions (resolved)

Provision trigger = invite+read-only on `signed`, full activation on `paid`. Org-per-client for all; SSO/SCIM on request. Native portal workspace. Concierge = Herald reuse. SOC 2 clock = **start now**. Sequence = **A first, trust track in parallel**. Remaining to confirm during Phase B: the exact tier→seat-cap model (depends on your pricing tiers) and which trust-center vendor.

## Related
- [[enterprise-onboarding-direction]] · discovery brief (research doc) · [[gb2g-agent-build-conventions]]
- Reference seams: `app/api/sign/[token]/route.ts`, `app/api/stripe/webhook/route.ts`, `app/api/intake/[sessionId]/submit/route.ts`, `app/(portal)/layout.tsx`, `lib/portal-auth.ts`, `lib/inngest/functions/devagent-run.ts` (idempotency model).
