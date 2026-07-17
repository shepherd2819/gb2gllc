-- ============================================================================
-- 035_hubspot_order_sync.sql
-- Per-order ledger for the Elevated Productions Spiro → HubSpot order
-- attribution sync (docs/superpowers/specs/2026-07-15-elevated-hubspot-order-sync-design.md).
-- No client_data_sources schema change: a provider='hubspot' row's own
-- config JSONB carries the sync's checkpoint + pairing (see that row's
-- config.last_order_sync_at / config.spiro_source_id), NOT the shared
-- last_sync_at column — that column is swept nightly by the unrelated
-- analytics-sync cron for every active source regardless of provider.
-- ============================================================================

CREATE TABLE IF NOT EXISTS hubspot_order_syncs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_id          UUID NOT NULL REFERENCES client_data_sources(id) ON DELETE CASCADE,
  spiro_order_id     TEXT NOT NULL,
  spiro_status       TEXT,
  hubspot_object_id  TEXT,
  hubspot_contact_id TEXT,
  match_status       TEXT NOT NULL CHECK (match_status IN ('matched','unmatched')),
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error              TEXT,
  UNIQUE (source_id, spiro_order_id)
);

CREATE INDEX IF NOT EXISTS hubspot_order_syncs_client_synced_idx
  ON hubspot_order_syncs (client_id, synced_at DESC);

ALTER TABLE hubspot_order_syncs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON hubspot_order_syncs FOR ALL USING (false);
