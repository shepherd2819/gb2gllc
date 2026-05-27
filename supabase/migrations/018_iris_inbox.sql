-- ============================================================
-- 018_iris_inbox.sql — Iris (internal inbox-management agent)
-- ============================================================
-- Admin-only tool. Not multi-tenant: keyed by WorkOS user id (the admin who
-- connected their inbox). Manages whatever Google account is connected,
-- including all aliases that route into that mailbox.
--
-- Pipeline: poll Gmail every 2m → classify w/ Haiku → label in Gmail +
-- (optionally) save a draft reply in the thread → surface in admin UI.
--
-- No auto-send. Drafts always require a human click.

CREATE TABLE iris_inbox_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_user_id    TEXT NOT NULL,                       -- admin who owns this connection
  provider          TEXT NOT NULL DEFAULT 'gmail' CHECK (provider IN ('gmail')),
  email_address     TEXT NOT NULL,                       -- primary mailbox address from Gmail profile
  aliases           TEXT[] NOT NULL DEFAULT '{}',        -- send-as / alias addresses (best-effort)
  access_token      TEXT NOT NULL,
  refresh_token     TEXT NOT NULL,
  token_expires_at  TIMESTAMPTZ NOT NULL,
  scope             TEXT,
  history_id        TEXT,                                -- Gmail historyId cursor for incremental polling
  last_polled_at    TIMESTAMPTZ,
  last_poll_error   TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workos_user_id, email_address)
);

CREATE INDEX idx_iris_accounts_status ON iris_inbox_accounts(status) WHERE status = 'active';

-- One row per inbound Gmail message we've ingested. body_text/body_html are
-- nulled out after 30d by the purge cron — classification + metadata kept
-- indefinitely so the dashboard view stays searchable.
CREATE TABLE iris_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES iris_inbox_accounts(id) ON DELETE CASCADE,
  gmail_message_id    TEXT NOT NULL,
  gmail_thread_id     TEXT NOT NULL,
  -- Headers (always retained)
  from_email          TEXT,
  from_name           TEXT,
  to_addresses        TEXT[] NOT NULL DEFAULT '{}',
  delivered_to        TEXT,                                -- the alias that received it (To header / Delivered-To)
  subject             TEXT,
  snippet             TEXT,
  received_at         TIMESTAMPTZ NOT NULL,
  -- Body (purged after 30 days)
  body_text           TEXT,
  body_html           TEXT,
  body_purged_at      TIMESTAMPTZ,
  -- Classification (filled by Haiku)
  category            TEXT,                                -- lead | support | internal | newsletter | calendar | spam | personal | other
  priority            TEXT,                                -- high | med | low
  reasoning           TEXT,                                -- 1-2 sentence why
  suggested_action    TEXT,                                -- short phrase: "Reply with intro deck", "Archive", "Forward to finance", etc.
  draft_reply         TEXT,                                -- Claude's draft body (plain text)
  classified_at       TIMESTAMPTZ,
  classify_model      TEXT,
  classify_error      TEXT,
  -- Gmail-side artifacts
  gmail_draft_id      TEXT,                                -- if we created a draft in the thread, this is its id
  gmail_label_id      TEXT,                                -- the Iris/* label we applied
  -- Workflow state
  status              TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new',          -- just ingested, awaiting classification
    'classified',   -- Claude has tagged it; draft (if any) saved in Gmail
    'sent',         -- admin sent the draft reply via Iris
    'archived',     -- admin dismissed it
    'flagged'       -- admin flagged for follow-up
  )),
  sent_at             TIMESTAMPTZ,
  archived_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, gmail_message_id)
);

CREATE INDEX idx_iris_messages_account_received ON iris_messages(account_id, received_at DESC);
CREATE INDEX idx_iris_messages_status           ON iris_messages(account_id, status, received_at DESC);
CREATE INDEX idx_iris_messages_category         ON iris_messages(account_id, category, received_at DESC);
CREATE INDEX idx_iris_messages_pending_classify ON iris_messages(account_id) WHERE status = 'new';
CREATE INDEX idx_iris_messages_purge_candidates ON iris_messages(received_at) WHERE body_purged_at IS NULL;

-- Per-account settings: which categories Iris is allowed to draft for, voice, etc.
CREATE TABLE iris_settings (
  account_id              UUID PRIMARY KEY REFERENCES iris_inbox_accounts(id) ON DELETE CASCADE,
  draft_categories        TEXT[] NOT NULL DEFAULT ARRAY['lead', 'support', 'internal']::TEXT[],
  ignore_from_patterns    TEXT[] NOT NULL DEFAULT ARRAY['noreply@', 'no-reply@', 'donotreply@', 'mailer-daemon@', 'notifications@github.com']::TEXT[],
  voice_notes             TEXT,                            -- free-text guidance for drafts ("warm but direct, no exclamation points, sign off 'John'")
  signature               TEXT,                            -- appended to all draft replies
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE iris_inbox_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE iris_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE iris_settings       ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON iris_inbox_accounts FOR ALL USING (false);
CREATE POLICY "service role only" ON iris_messages       FOR ALL USING (false);
CREATE POLICY "service role only" ON iris_settings       FOR ALL USING (false);
