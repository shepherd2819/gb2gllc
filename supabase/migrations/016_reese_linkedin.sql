-- ============================================================
-- 016_reese_linkedin.sql — Reese (LinkedIn agent) — multi-tenant schema
-- ============================================================

-- Register "linkedin" as a Steward platform agent
INSERT INTO steward_platform_agents (id, display_name, icon, description, available) VALUES
  ('linkedin', 'LinkedIn', '💼', 'Drafts and posts LinkedIn content on the client''s personal or company account', true)
ON CONFLICT (id) DO NOTHING;

-- Per-client Reese config
CREATE TABLE client_linkedin_configs (
  client_id           UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  content_pillars     TEXT[],                              -- e.g. ['ai-strategy', 'building-in-public', 'tips']
  voice_notes         TEXT,                                -- brand-voice instructions
  ctas                TEXT[],                              -- rotation of CTAs to weave in (e.g. ["Reply 'Reese' to chat", "DM me to talk through it"])
  hashtags            TEXT[],                              -- default hashtag set
  banned_words        TEXT[],                              -- never include these
  posting_cadence     TEXT NOT NULL DEFAULT 'weekdays',    -- 'daily', 'weekdays', 'mwf', 'ondemand'
  posting_time_local  TEXT NOT NULL DEFAULT '08:30',       -- HH:MM in client's timezone
  timezone            TEXT NOT NULL DEFAULT 'America/Chicago',
  auto_publish        BOOLEAN NOT NULL DEFAULT false,      -- if false, admin must approve each post
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LinkedIn post queue — drafts, scheduled, published, performance
CREATE TABLE linkedin_posts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  pillar              TEXT,                                -- which content pillar this serves
  draft_text          TEXT NOT NULL,                       -- the post body Reese drafted
  edited_text         TEXT,                                -- admin override if changed before publishing
  status              TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'scheduled', 'published', 'rejected', 'failed')) DEFAULT 'draft',
  -- Scheduling
  scheduled_for       TIMESTAMPTZ,
  published_at        TIMESTAMPTZ,
  -- LinkedIn IDs
  posted_as           TEXT,                                -- 'member' or 'organization'
  linkedin_urn        TEXT,                                -- urn:li:share:... after publish
  linkedin_url        TEXT,                                -- viewable URL
  -- Performance (filled in async)
  impressions         INTEGER,
  likes               INTEGER,
  comments            INTEGER,
  shares              INTEGER,
  clicks              INTEGER,
  metrics_pulled_at   TIMESTAMPTZ,
  -- Drafter metadata
  draft_model         TEXT,
  draft_tokens        INTEGER,
  rejected_reason     TEXT,
  -- Audit
  approved_by         TEXT,                                -- WorkOS user id of approver
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_linkedin_posts_client_status   ON linkedin_posts(client_id, status, created_at DESC);
CREATE INDEX idx_linkedin_posts_scheduled       ON linkedin_posts(scheduled_for) WHERE status IN ('approved', 'scheduled');
CREATE INDEX idx_linkedin_posts_metrics_pending ON linkedin_posts(published_at) WHERE status = 'published' AND metrics_pulled_at IS NULL;

ALTER TABLE client_linkedin_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkedin_posts          ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON client_linkedin_configs FOR ALL USING (false);
CREATE POLICY "service role only" ON linkedin_posts          FOR ALL USING (false);
