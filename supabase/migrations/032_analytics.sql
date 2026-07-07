-- ============================================================
-- 032_analytics.sql — Analytics dashboard (warehouse + AI chat)
-- ============================================================
-- Hybrid data-source connectors (REST sync + MCP chat), a per-client metrics
-- warehouse with idempotent re-sync upserts, one precomputed snapshot row per
-- client (one-query page loads), ask-your-data conversations/messages,
-- append-only audit events, and a weekly digest log.
-- All access via supabaseAdmin; scope every query by client_id.

CREATE TABLE client_data_sources (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('mcp','rest')),
  provider            TEXT NOT NULL,        -- 'spiro', 'generic_mcp'; future: 'stripe', …
  label               TEXT NOT NULL,        -- admin-facing, e.g. "Spiro — production"
  config              JSONB NOT NULL DEFAULT '{}'::jsonb,  -- non-secret: base/endpoint URL, account, timezone
  secret_enc          TEXT,                 -- AES-256-GCM blob (lib/analytics/crypto.ts); NULL = no credential
  chat_tool_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb,  -- MCP tool names admin approved for chat
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','paused','error')),
  last_sync_at        TIMESTAMPTZ,
  last_sync_error     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, provider, label)
);

-- The warehouse. dimension_key is the canonical serialization of dimension
-- (sorted keys, k=v joined '|', '' = undimensioned; lib/analytics/types.ts
-- dimensionKey) so the UNIQUE constraint makes re-syncs idempotent upserts.
CREATE TABLE analytics_metrics (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_id      UUID NOT NULL REFERENCES client_data_sources(id) ON DELETE CASCADE,
  metric         TEXT NOT NULL,             -- 'orders.count', 'orders.revenue', …
  grain          TEXT NOT NULL CHECK (grain IN ('day','week','month')),
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  dimension      JSONB NOT NULL DEFAULT '{}'::jsonb,
  dimension_key  TEXT NOT NULL DEFAULT '',
  value          NUMERIC NOT NULL,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, metric, grain, period_start, dimension_key)
);

-- One row per client; dashboard pages read ONLY this (nora last_metrics_json pattern).
CREATE TABLE analytics_snapshots (
  client_id    UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- precomputed tile/chart/table data
  insights     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- AI cards (title/body/tone), generated post-sync
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE analytics_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL,                -- WorkOS user id
  title       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE analytics_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES analytics_conversations(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content          TEXT NOT NULL,
  tool_calls       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- audit: name, input, sourceId, ms, ok
  model            TEXT,
  tokens_used      INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only audit (onboarding_events shape). kinds: source.connected|updated|
-- paused|removed, sync.completed|failed, chat.query, export.csv|pdf, digest.sent.
CREATE TABLE analytics_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  actor       TEXT NOT NULL DEFAULT 'system',  -- admin email / WorkOS user id / 'system'
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Weekly digest log (herald_digests shape).
CREATE TABLE analytics_digests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_start  TIMESTAMPTZ NOT NULL,
  period_end    TIMESTAMPTZ NOT NULL,
  metrics_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  html          TEXT,
  resend_id     TEXT,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Digest opt-out (herald_digest_enabled precedent). Inert until a source
-- connects: digest sends additionally require >=1 active source.
ALTER TABLE clients ADD COLUMN analytics_digest_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX idx_analytics_sources_client        ON client_data_sources(client_id);
CREATE INDEX idx_analytics_metrics_client        ON analytics_metrics(client_id, metric, period_start DESC);
CREATE INDEX idx_analytics_conversations_client  ON analytics_conversations(client_id, created_at DESC);
CREATE INDEX idx_analytics_messages_conversation ON analytics_messages(conversation_id, created_at);
CREATE INDEX idx_analytics_messages_client       ON analytics_messages(client_id, created_at DESC);
CREATE INDEX idx_analytics_events_client         ON analytics_events(client_id, created_at DESC);
CREATE INDEX idx_analytics_digests_client        ON analytics_digests(client_id, created_at DESC);

ALTER TABLE client_data_sources     ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_metrics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_digests       ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON client_data_sources     FOR ALL USING (false);
CREATE POLICY "service role only" ON analytics_metrics       FOR ALL USING (false);
CREATE POLICY "service role only" ON analytics_snapshots     FOR ALL USING (false);
CREATE POLICY "service role only" ON analytics_conversations FOR ALL USING (false);
CREATE POLICY "service role only" ON analytics_messages      FOR ALL USING (false);
CREATE POLICY "service role only" ON analytics_events        FOR ALL USING (false);
CREATE POLICY "service role only" ON analytics_digests       FOR ALL USING (false);
