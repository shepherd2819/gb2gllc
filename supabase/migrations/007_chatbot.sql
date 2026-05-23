-- ============================================================
-- 007_chatbot.sql — Chatbot.com (Herald) integration
-- ============================================================

ALTER TABLE clients
  ADD COLUMN chatbot_bot_id TEXT,
  ADD COLUMN herald_digest_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN herald_digest_last_sent_at TIMESTAMPTZ;

-- Track each digest send for debugging / audit
CREATE TABLE herald_digests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_start      TIMESTAMPTZ NOT NULL,
  period_end        TIMESTAMPTZ NOT NULL,
  metrics           JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error             TEXT,
  resend_id         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_herald_digests_client ON herald_digests(client_id, created_at DESC);

ALTER TABLE herald_digests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON herald_digests FOR ALL USING (false);
