-- ============================================================
-- 023_devagent_phase2.sql — Ada Phase 2 (ticket-triggered, per-client)
-- ============================================================
-- Sibling tables to client_steward_assignments / steward_runs. Ada
-- targets the GB2G repo (multi-tenant is Phase 3). Each client has one
-- assignment row controlling auto-trigger; each dispatch creates one
-- run row; each Ada touch on a ticket writes a ticket_events row.

-- ── tickets: category + Ada link + awaiting_review status ─────────────
ALTER TABLE tickets ADD COLUMN category TEXT;
ALTER TABLE tickets ADD COLUMN ada_run_id UUID;
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('open', 'in_progress', 'resolved', 'awaiting_review'));

-- ── Per-client config (PK on client_id; one row per client) ───────────
CREATE TABLE client_devagent_assignments (
  client_id          UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  mission            TEXT NOT NULL DEFAULT
    'Implement the requested change end-to-end on the GB2G repo, following existing conventions. Open a PR; auto-merge only when verification is green and the diff is in the low-risk scope. Use Ada''s verifier/reviewer subagents.',
  trigger_categories TEXT[] NOT NULL DEFAULT '{}',
  budget_overrides   JSONB,
  active             BOOLEAN NOT NULL DEFAULT FALSE,
  last_run_at        TIMESTAMPTZ,
  last_run_status    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Run records (one per dispatch) ────────────────────────────────────
CREATE TABLE devagent_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  triggering_ticket_id  UUID REFERENCES tickets(id) ON DELETE SET NULL,
  trigger               TEXT NOT NULL CHECK (trigger IN ('ticket', 'manual', 'scheduled')),
  task_text             TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN
                            ('queued','running','completed_merged','completed_needs_review','failed')),
  ship                  JSONB,
  tokens_used           INTEGER,
  cost_usd              NUMERIC(10, 6),
  error                 TEXT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);
CREATE INDEX idx_devagent_runs_client ON devagent_runs(client_id, started_at DESC);
CREATE INDEX idx_devagent_runs_ticket ON devagent_runs(triggering_ticket_id)
  WHERE triggering_ticket_id IS NOT NULL;
CREATE INDEX idx_devagent_runs_status ON devagent_runs(status) WHERE status IN ('queued','running');

ALTER TABLE tickets ADD CONSTRAINT tickets_ada_run_id_fkey
  FOREIGN KEY (ada_run_id) REFERENCES devagent_runs(id) ON DELETE SET NULL;

-- ── Ticket event timeline (Ada writes here; reusable surface) ─────────
CREATE TABLE ticket_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN
                ('ada_dispatched','ada_completed','ada_failed','status_changed','comment')),
  actor       TEXT NOT NULL CHECK (actor IN ('ada','admin','client','system')),
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  body        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ticket_events_ticket ON ticket_events(ticket_id, created_at DESC);

-- ── RLS service-role-only on all new tables (repo convention) ─────────
ALTER TABLE client_devagent_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON client_devagent_assignments FOR ALL USING (false);
ALTER TABLE devagent_runs                ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON devagent_runs                FOR ALL USING (false);
ALTER TABLE ticket_events                ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON ticket_events                FOR ALL USING (false);
