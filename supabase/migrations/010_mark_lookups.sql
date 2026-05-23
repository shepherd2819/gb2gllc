-- ============================================================
-- 010_mark_lookups.sql — Persistent log of Mark's /sqft invocations
-- ============================================================

CREATE TABLE mark_lookups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID REFERENCES clients(id) ON DELETE CASCADE,
  slack_team_id    TEXT,
  slack_user_id    TEXT,
  slack_channel_id TEXT,
  input_address    TEXT NOT NULL,
  normalized       TEXT,
  sqft             INTEGER,
  beds             INTEGER,
  baths            NUMERIC(4,1),
  year_built       INTEGER,
  property_type    TEXT,
  status           TEXT NOT NULL CHECK (status IN ('found', 'not_found', 'error')),
  error            TEXT,
  raw              JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mark_lookups_client ON mark_lookups(client_id, created_at DESC);
CREATE INDEX idx_mark_lookups_team   ON mark_lookups(slack_team_id, created_at DESC);

ALTER TABLE mark_lookups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON mark_lookups FOR ALL USING (false);
