-- ============================================================
-- 015_june_demo.sql — June (homepage demo agent) attempt log + rate limit
-- ============================================================
-- One row per visitor IP. UNIQUE(ip) enforces the "1 PDF per IP forever" cap.
-- We allow updates so a visitor can finish their conversation; only the PDF
-- generation step is one-shot.

CREATE TABLE june_demo_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip              TEXT NOT NULL UNIQUE,
  user_agent      TEXT,
  conversation    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{role, content}, ...]
  website_url     TEXT,                                -- URL they asked us to audit
  scraped_text    TEXT,                                -- raw text we pulled from their site
  audit_data      JSONB,                               -- Claude's structured audit output
  pdf_generated_at TIMESTAMPTZ,
  email           TEXT,                                -- where they had it sent
  email_sent_at   TIMESTAMPTZ,
  resend_id       TEXT,
  status          TEXT NOT NULL DEFAULT 'chatting'
                  CHECK (status IN ('chatting', 'auditing', 'audit_ready', 'emailed', 'blocked', 'errored')),
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_june_demo_attempts_status ON june_demo_attempts(status, created_at DESC);

ALTER TABLE june_demo_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON june_demo_attempts FOR ALL USING (false);
