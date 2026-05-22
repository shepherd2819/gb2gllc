-- ============================================================
-- 003_admin.sql — Admin portal additions
-- ============================================================

-- Add Stripe customer ID + account status to clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'disabled'));

-- Per-client event log (Herald calls, errors, intake events, etc.)
CREATE TABLE client_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  session_id  TEXT,                        -- intake or herald session
  level       TEXT NOT NULL DEFAULT 'info'
    CHECK (level IN ('info', 'warn', 'error')),
  category    TEXT NOT NULL,               -- 'herald', 'intake', 'steward', 'system'
  message     TEXT NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX client_logs_client_id_idx ON client_logs(client_id);
CREATE INDEX client_logs_created_at_idx ON client_logs(created_at DESC);

-- Stripe invoices we've sent
CREATE TABLE invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  stripe_invoice_id   TEXT UNIQUE,
  amount_cents        INTEGER NOT NULL,
  description         TEXT,
  status              TEXT DEFAULT 'draft',
  sent_at             TIMESTAMPTZ,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE client_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices    ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON client_logs FOR ALL USING (false);
CREATE POLICY "service role only" ON invoices    FOR ALL USING (false);
