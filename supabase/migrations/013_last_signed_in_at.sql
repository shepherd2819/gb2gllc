-- ============================================================
-- 013_last_signed_in_at.sql — Track client portal sign-in activity
-- ============================================================

ALTER TABLE clients
  ADD COLUMN last_signed_in_at TIMESTAMPTZ;

ALTER TABLE client_members
  ADD COLUMN last_signed_in_at TIMESTAMPTZ;

COMMENT ON COLUMN clients.last_signed_in_at IS
  'Updated by the portal layout on each authenticated visit (debounced to once per ~5 min). NULL means never signed in.';
COMMENT ON COLUMN client_members.last_signed_in_at IS
  'Same as clients.last_signed_in_at but for teammate accounts.';
