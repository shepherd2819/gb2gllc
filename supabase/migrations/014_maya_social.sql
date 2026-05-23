-- ============================================================
-- 014_maya_social.sql — Maya (social media DM + comment manager)
-- ============================================================

-- Add 'meta' as a platform agent so client_steward_assignments.platform_agent_id can reference it
INSERT INTO steward_platform_agents (id, display_name, icon, description, available) VALUES
  ('meta', 'Meta (Facebook + Instagram)', '📱', 'DMs and comments on Facebook Pages and Instagram Business accounts', true)
ON CONFLICT (id) DO NOTHING;

-- Per-client routing config for Maya. One row per client.
CREATE TABLE client_social_configs (
  client_id           UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  website_url         TEXT,
  booking_url         TEXT,
  order_url           TEXT,
  custom_link_label   TEXT,
  custom_link_url     TEXT,
  custom_instructions TEXT,
  escalation_channel  TEXT,                 -- Slack channel ID for "needs human" alerts (e.g. C12345)
  business_hours      TEXT,                 -- free-text like "Mon-Fri 9-5 CT"; used in replies
  reply_to_comments   BOOLEAN NOT NULL DEFAULT true,
  reply_to_dms        BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Map Meta Page IDs / IG Business Account IDs → client_id. Fast lookup at webhook time.
-- One Meta page can serve only one client (1:1), but a client can have many pages.
CREATE TABLE meta_page_subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  page_id                  TEXT NOT NULL UNIQUE,     -- the FB Page ID
  page_name                TEXT NOT NULL,
  page_access_token        TEXT NOT NULL,            -- long-lived page token
  instagram_account_id     TEXT UNIQUE,              -- IG Business Account ID linked to this page (if any)
  instagram_username       TEXT,
  installed_by_workos_user TEXT,
  installed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active                   BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_meta_page_subscriptions_client    ON meta_page_subscriptions(client_id);
CREATE INDEX idx_meta_page_subscriptions_ig_acct   ON meta_page_subscriptions(instagram_account_id) WHERE instagram_account_id IS NOT NULL;

-- Audit log of every Maya interaction (incoming + outgoing). Drives admin/portal history views.
CREATE TABLE social_interactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID REFERENCES clients(id) ON DELETE CASCADE,
  platform            TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  kind                TEXT NOT NULL CHECK (kind IN ('dm', 'comment', 'private_reply')),
  direction           TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  -- Source identifiers
  page_id             TEXT,
  ig_account_id       TEXT,
  sender_id           TEXT,                  -- PSID for FB, IGSID for IG
  sender_username     TEXT,
  thread_id           TEXT,                  -- conversation/post id for grouping
  in_reply_to_comment TEXT,                  -- comment_id when this is a reply
  -- Content
  text                TEXT NOT NULL,
  -- Bot bookkeeping
  status              TEXT NOT NULL CHECK (status IN ('received', 'replied', 'escalated', 'ignored', 'error')),
  escalation_reason   TEXT,
  error               TEXT,
  raw                 JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_social_interactions_client       ON social_interactions(client_id, created_at DESC);
CREATE INDEX idx_social_interactions_thread       ON social_interactions(thread_id, created_at);
CREATE INDEX idx_social_interactions_page         ON social_interactions(page_id, created_at DESC);

-- RLS: service-role only (matches every other table in this project)
ALTER TABLE client_social_configs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_page_subscriptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_interactions         ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON client_social_configs   FOR ALL USING (false);
CREATE POLICY "service role only" ON meta_page_subscriptions FOR ALL USING (false);
CREATE POLICY "service role only" ON social_interactions     FOR ALL USING (false);
