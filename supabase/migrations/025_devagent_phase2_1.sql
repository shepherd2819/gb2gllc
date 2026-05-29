-- ============================================================
-- 025_devagent_phase2_1.sql — Ada Phase 2.1 (step idempotency)
-- ============================================================
-- Adds the idempotency support Phase 2 deferred:
--   * devagent_runs.idempotency_key + unique index → createRun UPSERT
--   * ticket_events unique partial index → applyAdaEvent ignoreDuplicates
-- See docs/superpowers/specs/2026-05-29-ada-dev-agent-phase-2-1-design.md §2.

ALTER TABLE devagent_runs ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX uq_devagent_runs_idem
  ON devagent_runs(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX uq_ticket_events_ada
  ON ticket_events(ticket_id, kind, (payload->>'run_id'))
  WHERE actor = 'ada' AND kind IN ('ada_dispatched','ada_completed','ada_failed');
