-- ============================================================
-- 006_steward_tokens.sql — Platform credential storage
-- ============================================================

CREATE TABLE steward_platform_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform   TEXT NOT NULL REFERENCES steward_platform_agents(id),
  token_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, platform)
);

CREATE INDEX steward_tokens_client_idx ON steward_platform_tokens(client_id);

CREATE OR REPLACE FUNCTION update_steward_token_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER steward_tokens_updated_at
  BEFORE UPDATE ON steward_platform_tokens
  FOR EACH ROW EXECUTE FUNCTION update_steward_token_updated_at();

ALTER TABLE steward_platform_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON steward_platform_tokens FOR ALL USING (false);
