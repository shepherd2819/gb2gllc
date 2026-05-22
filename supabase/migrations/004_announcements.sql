-- ============================================================
-- 004_announcements.sql — Announcements system
-- ============================================================

CREATE TABLE announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE, -- NULL = broadcast to all active clients
  title       TEXT NOT NULL,
  body        TEXT,
  type        TEXT DEFAULT 'info' CHECK (type IN ('info', 'update', 'action_required')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ
);

CREATE TABLE announcement_dismissals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id  UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  dismissed_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(announcement_id, client_id)
);

ALTER TABLE announcements             ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_dismissals   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only" ON announcements           FOR ALL USING (false);
CREATE POLICY "service role only" ON announcement_dismissals FOR ALL USING (false);
