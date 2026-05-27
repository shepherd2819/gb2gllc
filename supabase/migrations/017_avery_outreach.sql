-- ============================================================
-- 017_avery_outreach.sql — Avery (internal outbound lead-outreach agent)
-- ============================================================
-- Admin-only tool. Not a multi-tenant client agent: no client_id on these
-- rows, no entry in steward_platform_agents. Used directly from /agents/avery.

CREATE TABLE avery_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  briefing_text   TEXT,                                -- pasted markdown / plain text
  briefing_pdf    TEXT,                                -- extracted text from uploaded PDF (merged in for Claude)
  briefing_pdf_filename TEXT,                          -- so admin remembers which file they uploaded
  sender_email    TEXT NOT NULL DEFAULT 'hello@gb2gllc.com',
  sender_name     TEXT NOT NULL DEFAULT 'Avery at GB2G',
  daily_send_cap  INTEGER NOT NULL DEFAULT 20 CHECK (daily_send_cap > 0 AND daily_send_cap <= 100),
  status          TEXT NOT NULL CHECK (status IN ('active', 'paused', 'done')) DEFAULT 'active',
  created_by      TEXT,                                -- WorkOS user id
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_avery_campaigns_status ON avery_campaigns(status, updated_at DESC);

CREATE TABLE avery_leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES avery_campaigns(id) ON DELETE CASCADE,
  -- Input data
  name            TEXT,
  email           TEXT,
  company         TEXT,
  website         TEXT,
  notes           TEXT,                                -- free-text notes from the admin / CSV
  -- Enrichment
  enrichment      JSONB,                               -- { scraped_text, contact_form_url, page_title, page_desc, ... }
  enriched_at     TIMESTAMPTZ,
  -- Draft
  draft_subject   TEXT,
  draft_body      TEXT,
  edited_subject  TEXT,
  edited_body     TEXT,
  draft_model     TEXT,
  draft_tokens    INTEGER,
  drafted_at      TIMESTAMPTZ,
  -- Sending
  status          TEXT NOT NULL CHECK (status IN (
    'pending',       -- in queue, no enrichment yet
    'researched',    -- enrichment done, no draft yet
    'drafted',       -- draft ready, awaiting admin approval
    'approved',      -- approved but not yet sent (rare; mostly skipped due to daily cap)
    'sent',          -- email delivered
    'rejected',      -- admin marked rejected
    'failed',        -- send failed
    'skipped'        -- skipped (e.g. no email, contact-form-only lead)
  )) DEFAULT 'pending',
  rejected_reason TEXT,
  send_error      TEXT,
  resend_id       TEXT,
  sent_at         TIMESTAMPTZ,
  approved_by     TEXT,                                -- WorkOS user id of approver
  approved_at     TIMESTAMPTZ,
  -- Audit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_avery_leads_campaign       ON avery_leads(campaign_id, status, created_at DESC);
CREATE INDEX idx_avery_leads_sent_at        ON avery_leads(sent_at DESC) WHERE sent_at IS NOT NULL;
CREATE INDEX idx_avery_leads_pending_work   ON avery_leads(campaign_id, status) WHERE status IN ('pending', 'researched');

ALTER TABLE avery_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE avery_leads     ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON avery_campaigns FOR ALL USING (false);
CREATE POLICY "service role only" ON avery_leads     FOR ALL USING (false);
