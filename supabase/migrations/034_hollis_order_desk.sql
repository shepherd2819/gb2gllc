-- ============================================================================
-- 034_hollis_order_desk.sql
-- Order-desk capability for a per-client Hollis line: Spiro source binding,
-- Slack channel, and an escalation ledger (reschedule / new order / cancel).
-- ============================================================================

ALTER TABLE hollis_lines
  ADD COLUMN IF NOT EXISTS order_ops_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS spiro_source_id UUID REFERENCES client_data_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS slack_channel_id TEXT;

CREATE TABLE IF NOT EXISTS hollis_escalations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  line_id           UUID REFERENCES hollis_lines(id) ON DELETE CASCADE,
  call_id           UUID REFERENCES hollis_calls(id) ON DELETE SET NULL,
  type              TEXT NOT NULL CHECK (type IN ('reschedule','new_order','cancel')),
  spiro_order_id    TEXT,
  tracking_code     TEXT,
  retell_call_id    TEXT,
  verified          BOOLEAN NOT NULL DEFAULT FALSE,
  caller_number     TEXT,
  spiro_agent_id    TEXT,
  payload           JSONB NOT NULL DEFAULT '{}',
  slack_channel     TEXT,
  slack_ts          TEXT,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','failed')),
  delivery_fallback TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hollis_escalations_client_created_idx
  ON hollis_escalations (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hollis_escalations_call_idx
  ON hollis_escalations (call_id);

ALTER TABLE hollis_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON hollis_escalations FOR ALL USING (false);
