# Ada Phase 2 — Platform-resident, Ticket-Triggered (Design Spec)

**Date:** 2026-05-29
**Status:** Design approved — awaiting spec review before implementation plan
**Predecessor:** `docs/superpowers/specs/2026-05-28-ada-dev-agent-design.md` (Phase 1, shipped)

## Summary

Ada Phase 2 turns Ada into a platform-resident agent. A portal ticket arrives → if its category matches the client's configured trigger allowlist, an Inngest event fires → an Inngest function spins up a **Vercel Sandbox**, clones the GB2G repo, runs Ada's Phase 1 core, then updates the originating ticket (status + timeline events) so the client sees Ada working. Per-client config + history live in a new admin `DevAgentManager` component matching the existing `*Manager+API` pattern (Avery/June/Iris/Wren/Holt).

## Goals

- Platform-resident execution: Ada runs without a human at the terminal.
- Per-client dispatch: each client has their own allowlist of trigger categories, mission, budget overrides, and active toggle.
- Full ticket loop: Ada writes timeline events on the ticket and transitions ticket status as she progresses.
- One bite-sized increment over Phase 1: same core (`lib/devagent/*`), new platform glue (`lib/devagent/platform/*`).

## Non-goals (Phase 2)

- **Multi-tenant** — Ada still targets the GB2G repo only. Targeting client repos is **Phase 3**.
- **Reflection / playbooks** — Phase 4.
- **Portal-facing Ada visibility** — clients see ticket-status transitions but not Ada's run internals. Admin sees everything.
- **Per-ticket budget overrides** — per-client only.
- **Human approval gate on PR before merge** — auto-merge stays unchanged from Phase 1.

## Architecture

```
[Portal client]
  POST /api/portal/tickets {clientId, subject, body, category}
       │ insert tickets row
       ▼
   after():
     if category ∈ client_devagent_assignments.trigger_categories AND active:
        inngest.send("devagent/run.requested", {clientId, ticketId, taskText})
     always: existing Slack notification (Wren's)

[Inngest fn devagent-run]
  insert devagent_runs row (status=queued)
  step: post-dispatch  → tickets.status='in_progress', ada_run_id=runId, ticket_events kind=ada_dispatched
  step: prepare-sandbox → Vercel Sandbox + clone GB2G repo (GH_TOKEN env)
  step: invoke-ada (nonRetriable) → runDevAgent({task, workspace: sandbox.cwd})
  step: finalize → ticket_events kind=ada_completed|ada_failed
                   tickets.status →  resolved        (run completed_merged)
                                  |  awaiting_review (needs-review OR failed)
                   devagent_runs row updated with ship/tokens/cost/error
  step: cleanup-sandbox

[Admin]
  app/(admin)/clients/[id]/DevAgentManager.tsx  (config + history + manual dispatch)
  app/api/admin/clients/[id]/devagent           (GET / PUT / POST per *Manager+API pattern)
  app/(admin)/support/[id]/page.tsx             (extended to render ticket_events + Ada-run badge)
```

**Inngest concurrency = 1 per `clientId`** — prevents two simultaneous dispatches from creating conflicting branches.

## Components

```
supabase/migrations/022_devagent_phase2.sql     schema additions

lib/devagent/platform/                          Phase 2 platform glue
  ticket-trigger.ts    shouldTrigger({assignment, ticket}) + enqueueFromTicket()
  ticket-update.ts     applyAdaEvent({ticketId, kind, payload}) — writes timeline + status
  sandbox.ts           Vercel Sandbox lifecycle: provision, clone w/ GH_TOKEN, → Workspace
  enqueue.ts           inngest.send wrapper for manual dispatches
  record.ts            DB-backed extension of Phase 1's record.ts (writes devagent_runs row)

lib/inngest/functions/devagent-run.ts            new Inngest function (lifecycle above)
lib/inngest/functions/devagent-cleanup.ts        daily cron: mark stale 'running' rows as failed

app/api/admin/clients/[id]/devagent/route.ts     requireAdmin; GET/PUT/POST
app/(admin)/clients/[id]/DevAgentManager.tsx     client component (config + history + manual)
app/(portal)/tickets/new/...                     add category dropdown
app/api/portal/tickets/route.ts                  emit Inngest event in after() block
app/(admin)/support/[id]/page.tsx                extended to render ticket_events + Ada badge

vercel.json                                      add cron entry for devagent-cleanup
```

## Schema (`022_devagent_phase2.sql`)

```sql
-- ── tickets: category + Ada link + awaiting_review status ─────────────────
ALTER TABLE tickets ADD COLUMN category TEXT;
ALTER TABLE tickets ADD COLUMN ada_run_id UUID;
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('open', 'in_progress', 'resolved', 'awaiting_review'));

-- ── Per-client config (PK on client_id; one row per client) ───────────────
CREATE TABLE client_devagent_assignments (
  client_id          UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  mission            TEXT NOT NULL DEFAULT
    'Implement the requested change end-to-end on the GB2G repo, following existing conventions. Open a PR; auto-merge only when verification is green and the diff is in the low-risk scope. Use Ada''s verifier/reviewer subagents.',
  trigger_categories TEXT[] NOT NULL DEFAULT '{}',
  budget_overrides   JSONB,   -- {maxTurns?, maxTokens?, maxWallMs?, maxChangedFiles?, maxChangedLines?}
  active             BOOLEAN NOT NULL DEFAULT FALSE,
  last_run_at        TIMESTAMPTZ,
  last_run_status    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Run records (one per dispatch) ────────────────────────────────────────
CREATE TABLE devagent_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  triggering_ticket_id  UUID REFERENCES tickets(id) ON DELETE SET NULL,
  trigger               TEXT NOT NULL CHECK (trigger IN ('ticket', 'manual', 'scheduled')),
  task_text             TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN
                            ('queued','running','completed_merged','completed_needs_review','failed')),
  ship                  JSONB,            -- ShipDecision: {prUrl, merged, evaluation, verify}
  tokens_used           INTEGER,
  cost_usd              NUMERIC(10, 6),
  error                 TEXT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);
CREATE INDEX idx_devagent_runs_client ON devagent_runs(client_id, started_at DESC);
CREATE INDEX idx_devagent_runs_ticket ON devagent_runs(triggering_ticket_id)
  WHERE triggering_ticket_id IS NOT NULL;
CREATE INDEX idx_devagent_runs_status ON devagent_runs(status) WHERE status IN ('queued', 'running');

ALTER TABLE tickets ADD CONSTRAINT tickets_ada_run_id_fkey
  FOREIGN KEY (ada_run_id) REFERENCES devagent_runs(id) ON DELETE SET NULL;

-- ── Ticket event timeline (Ada writes here; generic surface for future) ───
CREATE TABLE ticket_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN
                ('ada_dispatched', 'ada_completed', 'ada_failed', 'status_changed', 'comment')),
  actor       TEXT NOT NULL CHECK (actor IN ('ada', 'admin', 'client', 'system')),
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  body        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ticket_events_ticket ON ticket_events(ticket_id, created_at DESC);

-- ── RLS service-role-only on all new tables ───────────────────────────────
ALTER TABLE client_devagent_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON client_devagent_assignments FOR ALL USING (false);
ALTER TABLE devagent_runs                ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON devagent_runs                FOR ALL USING (false);
ALTER TABLE ticket_events                ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON ticket_events                FOR ALL USING (false);
```

## Data flow

### Auto-trigger from a portal ticket

1. Client submits the portal ticket form (now with a category dropdown) → `POST /api/portal/tickets`.
2. Handler inserts the row, returns success to the client immediately.
3. In `after()`:
   - Read `client_devagent_assignments` for `clientId`.
   - If `active` AND `category ∈ trigger_categories` → `inngest.send("devagent/run.requested", { clientId, ticketId, taskText: subject + "\n\n" + body })`.
   - Always: existing Slack notification (Wren's, unchanged).
4. Inngest delivers the event to `devagent-run` (concurrency=1 per `clientId`).
5. Function executes the lifecycle (insert row → post dispatch → sandbox → invoke → finalize → cleanup). Each major transition writes a `ticket_events` row and updates `tickets.status`.

### Manual dispatch from DevAgentManager

1. Admin enters task text and clicks "Dispatch Ada" in DevAgentManager.
2. Component calls `POST /api/admin/clients/[id]/devagent`.
3. Route handler: `requireAdmin`, then `inngest.send("devagent/run.requested", { clientId, ticketId: null, taskText, trigger: "manual" })`.
4. Same Inngest function runs the lifecycle. `ticketId === null` → skip the `ticket_events` and `tickets.status` writes; run still records to `devagent_runs`.

## Error handling

- **Sandbox provisioning fails** → run row `status='failed'`, `error='sandbox-provision: …'`; ticket → `awaiting_review` + `ada_failed` event.
- **`runDevAgent` throws** → caught inside Phase 1's `run.ts` (`RunResult.status='failed', error=msg`). The Inngest finalize step records it cleanly.
- **Inngest infrastructure crash mid-run** → the `invoke-ada` step is marked `nonRetriable: true` to prevent duplicate PRs. The row stays at `running`; the daily `devagent-cleanup` cron marks stale runs (`now - started_at > maxWallMs * 2`) as `failed`.
- **Per-client concurrency=1** → a second event queues behind the first; no race for branch names or sandboxes.
- **Notification failures** (Slack, etc.) — logged, but don't block run-state updates.

## Testing

- **Unit (pure functions, TDD-style):** `shouldTrigger({assignment, ticket})` truth table (active+match, active+mismatch, inactive, no-assignment-row); `applyAdaEvent` payload composition; `categoryAllowlistDefaults`.
- **Integration (mocked Inngest + Supabase + fake `runDevAgent`):** end-to-end lifecycle assertion — given a ticket of triggering category and a fake completed run, expect: `devagent_runs` row inserted then updated, `ticket_events` rows written in order, `tickets.status` transitions, `tickets.ada_run_id` set.
- **Smoke (env-flagged, manual):** `ADA_PHASE2_SMOKE=1` — emits a real `devagent/run.requested` event with a tiny task ("add a code comment"), watches the run through Inngest's local dev UI, asserts the PR opened. Costs tokens + a tiny Vercel Sandbox.

## Build order

1. Migration `022_devagent_phase2.sql`.
2. `lib/devagent/platform/*` modules (TDD on the pure-function logic in `ticket-trigger.ts`).
3. `lib/inngest/functions/devagent-run.ts` + integration test.
4. Admin route + `DevAgentManager.tsx` component.
5. Portal ticket form: category dropdown.
6. Portal POST handler: emit Inngest event.
7. Admin `/support/[id]` page: render timeline + Ada run badge.
8. `lib/inngest/functions/devagent-cleanup.ts` + `vercel.json` cron entry.
9. Smoke runner.

## Out of scope (later phases)

- **Phase 3:** multi-tenant (Ada targeting client repos with per-client repo credentials).
- **Phase 4:** reflection / playbooks (Ada writes playbooks from her own successful runs).
- Portal-facing visibility into Ada runs (clients only see ticket-status transitions today).
- Per-ticket budget overrides (per-client only for now).
- Human approval gate on PR before merge (auto-merge stays unchanged from Phase 1).

## Open decisions (defaults — approved with "send it")

1. **Default `trigger_categories` on a fresh assignment** — `{}` (empty, opt-in). Admin must explicitly add categories to enable auto-trigger.
2. **Default mission text** — set in the schema's `DEFAULT` clause above.
3. **Cleanup cron cadence** — daily at 03:00 UTC.
4. **Portal category list (initial hard-coded set)** — Question / Bug Report / Feature Request / Code Fix / Other.
5. **`ticket_events` table is generic** — Ada writes to it now; same table reusable for future admin/client comments without schema change.

## Pointers

- Phase 1 spec: `docs/superpowers/specs/2026-05-28-ada-dev-agent-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-05-28-ada-dev-agent-phase-1.md`
- Phase 1 code: `lib/devagent/` + `scripts/devagent.ts`
- Wren migration (precedent): `supabase/migrations/019_wren.sql`
- Existing Inngest function (precedent): `lib/inngest/functions/steward-scheduled.ts`
- Portal tickets schema: `supabase/migrations/002_portal.sql`
- Portal tickets POST handler: `app/api/portal/tickets/route.ts`
