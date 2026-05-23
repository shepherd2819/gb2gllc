-- ============================================================
-- 009_steward_preset_id.sql — Track which preset created an assignment
-- ============================================================

ALTER TABLE client_steward_assignments
  ADD COLUMN preset_id TEXT;

COMMENT ON COLUMN client_steward_assignments.preset_id IS
  'Reference to the lib/steward/presets.ts entry (e.g. "mark_sqft"). Null for legacy free-form assignments.';
