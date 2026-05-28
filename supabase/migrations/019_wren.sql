-- ============================================================
-- 019_wren.sql — Wren (support-mailbox triage agent, sibling to Iris)
-- ============================================================
-- Admin-only tool. Single Google account connected at support@gb2gllc.com
-- (the schema supports many, but v1 uses one). Mirrors 018_iris_inbox.sql
-- with: support-tuned categories, a matched_client_id reference for warm
-- context, and a Wren/{category} Gmail label namespace.
--
-- Pipeline: poll Gmail every 2m → classify w/ Haiku → label in Gmail +
-- (optionally) save a draft reply in the thread → surface in /agents/wren.
-- No auto-send. Human approves every send.

CREATE TABLE wren_inbox_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_user_id    TEXT NOT NULL,
  provider          TEXT NOT NULL DEFAULT 'gmail' CHECK (provider IN ('gmail')),
  email_address     TEXT NOT NULL,
  aliases           TEXT[] NOT NULL DEFAULT '{}',
  access_token      TEXT NOT NULL,
  refresh_token     TEXT NOT NULL,
  token_expires_at  TIMESTAMPTZ NOT NULL,
  scope             TEXT,
  history_id        TEXT,
  last_polled_at    TIMESTAMPTZ,
  last_poll_error   TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workos_user_id, email_address)
);

CREATE INDEX idx_wren_accounts_status ON wren_inbox_accounts(status) WHERE status = 'active';

CREATE TABLE wren_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES wren_inbox_accounts(id) ON DELETE CASCADE,
  gmail_message_id    TEXT NOT NULL,
  gmail_thread_id     TEXT NOT NULL,
  from_email          TEXT,
  from_name           TEXT,
  to_addresses        TEXT[] NOT NULL DEFAULT '{}',
  delivered_to        TEXT,
  subject             TEXT,
  snippet             TEXT,
  received_at         TIMESTAMPTZ NOT NULL,
  body_text           TEXT,
  body_html           TEXT,
  body_purged_at      TIMESTAMPTZ,
  category            TEXT,    -- bug | feature_request | account_help | billing_question | general | spam
  priority            TEXT,    -- high | med | low
  reasoning           TEXT,
  suggested_action    TEXT,
  draft_reply         TEXT,
  matched_client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,
  classified_at       TIMESTAMPTZ,
  classify_model      TEXT,
  classify_error      TEXT,
  gmail_draft_id      TEXT,
  gmail_label_id      TEXT,
  status              TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'classified', 'sent', 'archived', 'flagged'
  )),
  sent_at             TIMESTAMPTZ,
  archived_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, gmail_message_id)
);

CREATE INDEX idx_wren_messages_account_received ON wren_messages(account_id, received_at DESC);
CREATE INDEX idx_wren_messages_status           ON wren_messages(account_id, status, received_at DESC);
CREATE INDEX idx_wren_messages_category         ON wren_messages(account_id, category, received_at DESC);
CREATE INDEX idx_wren_messages_pending_classify ON wren_messages(account_id) WHERE status = 'new';
CREATE INDEX idx_wren_messages_purge_candidates ON wren_messages(received_at) WHERE body_purged_at IS NULL;

CREATE TABLE wren_settings (
  account_id              UUID PRIMARY KEY REFERENCES wren_inbox_accounts(id) ON DELETE CASCADE,
  draft_categories        TEXT[] NOT NULL DEFAULT ARRAY['bug','feature_request','account_help','billing_question','general']::TEXT[],
  ignore_from_patterns    TEXT[] NOT NULL DEFAULT ARRAY['noreply@','no-reply@','donotreply@','mailer-daemon@']::TEXT[],
  voice_notes             TEXT,
  signature               TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wren_inbox_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wren_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE wren_settings       ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON wren_inbox_accounts FOR ALL USING (false);
CREATE POLICY "service role only" ON wren_messages       FOR ALL USING (false);
CREATE POLICY "service role only" ON wren_settings       FOR ALL USING (false);
