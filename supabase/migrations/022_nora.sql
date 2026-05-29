-- ============================================================
-- 022_nora.sql — Nora (internal Stripe finance / AR agent)
-- ============================================================
-- Admin-only tool. Sibling to Iris/Wren/Holt. Connects to a Stripe
-- account via a restricted API key + webhook signing secret. Watches
-- for failed payments / disputes / cancellations and drafts polite
-- dunning emails for human approval. Sends a weekly cash digest.

CREATE TABLE nora_accounts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_user_id          TEXT NOT NULL,
  label                   TEXT NOT NULL,                       -- e.g. "GB2G LLC main", set on connect
  stripe_account_id       TEXT,                                -- acct_* — discovered via /v1/account on connect
  stripe_secret_key       TEXT NOT NULL,                       -- restricted key, server-side only (RLS service-role)
  stripe_webhook_secret   TEXT,                                -- whsec_*, set when user wires up webhook
  livemode                BOOLEAN NOT NULL DEFAULT TRUE,
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked')),
  last_polled_at          TIMESTAMPTZ,
  last_poll_error         TEXT,
  last_metrics_json       JSONB,                               -- cached snapshot: balance, mrr, open_invoices_count, etc.
  last_metrics_at         TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workos_user_id, label)
);

CREATE INDEX idx_nora_accounts_status ON nora_accounts(status) WHERE status = 'active';

-- One row per actionable Stripe event Nora observed (from webhook or poll).
-- Idempotent on stripe_event_id (webhook can deliver the same event twice).
CREATE TABLE nora_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID NOT NULL REFERENCES nora_accounts(id) ON DELETE CASCADE,
  stripe_event_id       TEXT NOT NULL,
  stripe_event_type     TEXT NOT NULL,                          -- e.g. invoice.payment_failed
  stripe_object_id      TEXT,                                   -- e.g. in_..., ch_..., sub_...
  stripe_customer_id    TEXT,
  customer_email        TEXT,
  customer_name         TEXT,
  amount_cents          BIGINT,                                 -- the dollar figure on the event (where applicable)
  currency              TEXT,
  -- Classification (filled by classify.ts)
  category              TEXT NOT NULL DEFAULT 'other' CHECK (category IN (
    'payment_failed',
    'subscription_canceled',
    'subscription_past_due',
    'charge_disputed',
    'charge_refunded',
    'payout_failed',
    'invoice_upcoming',
    'new_subscription',
    'other'
  )),
  severity              TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('critical', 'warn', 'info')),
  summary               TEXT NOT NULL,
  -- Optional dunning draft (we draft only for payment_failed + subscription_past_due)
  draft_to_email        TEXT,
  draft_subject         TEXT,
  draft_body            TEXT,
  draft_model           TEXT,
  drafted_at            TIMESTAMPTZ,
  draft_error           TEXT,
  -- Workflow state
  status                TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new',              -- just ingested
    'classified',       -- summary written, draft (if any) ready
    'sent',             -- admin sent the dunning email via Nora
    'acknowledged',     -- admin marked seen, no action needed
    'dismissed'         -- admin dismissed
  )),
  alert_email_id        TEXT,                                  -- Resend id for the alert-to-admin email (not the dunning)
  alert_sent_at         TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  payload_json          JSONB NOT NULL DEFAULT '{}'::JSONB,    -- raw stripe event for audit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, stripe_event_id)
);

CREATE INDEX idx_nora_events_account_created ON nora_events(account_id, created_at DESC);
CREATE INDEX idx_nora_events_status          ON nora_events(account_id, status, created_at DESC);
CREATE INDEX idx_nora_events_severity        ON nora_events(account_id, severity, created_at DESC);
CREATE INDEX idx_nora_events_pending_dunning ON nora_events(account_id) WHERE status = 'classified' AND draft_body IS NOT NULL;

-- Weekly digest history (so we don't double-send + admins can read old ones)
CREATE TABLE nora_digests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES nora_accounts(id) ON DELETE CASCADE,
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  metrics_json    JSONB NOT NULL,                              -- balance, MRR, top customers, etc.
  markdown        TEXT NOT NULL,
  sent_at         TIMESTAMPTZ,
  resend_id       TEXT,
  send_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_nora_digests_account_period ON nora_digests(account_id, period_end DESC);

CREATE TABLE nora_settings (
  account_id              UUID PRIMARY KEY REFERENCES nora_accounts(id) ON DELETE CASCADE,
  -- Dunning behavior
  dunning_enabled         BOOLEAN NOT NULL DEFAULT TRUE,        -- whether to auto-draft (never sends)
  dunning_voice_notes     TEXT,
  dunning_signature       TEXT,
  -- What triggers an immediate "alert me" email
  urgent_alert_categories TEXT[] NOT NULL DEFAULT ARRAY['payment_failed', 'charge_disputed', 'payout_failed']::TEXT[],
  -- Where alerts + digests go (defaults to ADMIN_EMAIL env)
  delivery_email          TEXT,
  -- Weekly digest schedule (Monday 08:00 by default)
  weekly_digest_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  weekly_digest_dow       INTEGER NOT NULL DEFAULT 1 CHECK (weekly_digest_dow BETWEEN 0 AND 6),  -- 0=Sun, 1=Mon, ...
  weekly_digest_local_hour INTEGER NOT NULL DEFAULT 8 CHECK (weekly_digest_local_hour BETWEEN 0 AND 23),
  timezone                TEXT NOT NULL DEFAULT 'America/Chicago',
  -- Cash runway estimate inputs (so Nora can compute a runway month figure)
  monthly_burn_cents      BIGINT,                              -- optional manual figure (e.g. 800000 = $8k/mo)
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE nora_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE nora_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE nora_digests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE nora_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON nora_accounts FOR ALL USING (false);
CREATE POLICY "service role only" ON nora_events   FOR ALL USING (false);
CREATE POLICY "service role only" ON nora_digests  FOR ALL USING (false);
CREATE POLICY "service role only" ON nora_settings FOR ALL USING (false);
