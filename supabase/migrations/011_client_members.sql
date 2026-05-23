-- ============================================================
-- 011_client_members.sql — Additional teammates on a client account
-- ============================================================
--
-- The clients table's workos_user_id is the "owner" of the account. This
-- table maps additional WorkOS users to the same client so a teammate can
-- sign in and see the same dashboard / connections / tickets.
--
-- Soft cap of 1 teammate per client is enforced in the API layer; this table
-- supports more in case we raise the cap later.

CREATE TABLE client_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  workos_user_id   TEXT,                      -- backfilled on first sign-in
  invited_by       UUID REFERENCES clients(id) ON DELETE SET NULL,  -- always the owner client.id
  invited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at        TIMESTAMPTZ,
  UNIQUE(client_id, email)
);

CREATE INDEX idx_client_members_workos_user_id ON client_members(workos_user_id) WHERE workos_user_id IS NOT NULL;
CREATE INDEX idx_client_members_email          ON client_members(LOWER(email));

ALTER TABLE client_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON client_members FOR ALL USING (false);
