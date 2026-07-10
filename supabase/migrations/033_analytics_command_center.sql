-- ============================================================
-- 033_analytics_command_center.sql — Command Center additions
-- ============================================================
-- Additive columns on analytics_snapshots for the executive command center:
-- the AI-written briefing narrative and per-client monthly goal targets
-- (pace-to-goal reads goal_json.revenue). No new tables, no RLS change — the
-- existing "service role only" policy on analytics_snapshots covers both new
-- columns. Applied manually at rollout (convention).

ALTER TABLE analytics_snapshots ADD COLUMN briefing TEXT;
ALTER TABLE analytics_snapshots ADD COLUMN goal_json JSONB NOT NULL DEFAULT '{}'::jsonb;
