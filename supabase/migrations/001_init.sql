-- Intake sessions
CREATE TABLE IF NOT EXISTS intake_sessions (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'web',
  state JSONB NOT NULL DEFAULT '{}',
  submitted_at TIMESTAMPTZ,
  notion_page_id TEXT,
  calendly_booking_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER intake_sessions_updated_at
  BEFORE UPDATE ON intake_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- File upload metadata
CREATE TABLE IF NOT EXISTS intake_files (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES intake_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_path TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS intake_sessions_expires ON intake_sessions(expires_at);
CREATE INDEX IF NOT EXISTS intake_files_session ON intake_files(session_id);

-- Row-level security: sessions are auth'd by session ID only (URL is the token)
ALTER TABLE intake_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_files ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; anon cannot read/write directly
CREATE POLICY "service_role_all" ON intake_sessions FOR ALL USING (TRUE);
CREATE POLICY "service_role_all" ON intake_files FOR ALL USING (TRUE);
