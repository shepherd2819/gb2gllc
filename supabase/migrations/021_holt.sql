-- ============================================================
-- 021_holt.sql — Holt (internal calendar-briefing agent)
-- ============================================================
-- Admin-only tool. Sibling to Iris/Wren. Read-only Google Calendar.
-- For each upcoming external meeting, builds a one-page briefing
-- (prior emails + web research) and emails it to the user:
--   - the night before (digest of tomorrow's externals)
--   - 2h before each meeting (deep dive)
-- No calendar mutations, ever.

CREATE TABLE holt_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_user_id    TEXT NOT NULL,
  email_address     TEXT NOT NULL,                       -- the Google account email
  access_token      TEXT NOT NULL,
  refresh_token     TEXT NOT NULL,
  token_expires_at  TIMESTAMPTZ NOT NULL,
  scope             TEXT,
  timezone          TEXT,                                -- IANA tz from Google calendar settings (e.g. "America/Chicago")
  last_polled_at    TIMESTAMPTZ,
  last_poll_error   TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workos_user_id, email_address)
);

CREATE INDEX idx_holt_accounts_status ON holt_accounts(status) WHERE status = 'active';

-- One row per (account, calendar_event) pair we've considered. Tracks
-- which briefing variants we've sent so we don't double-send.
CREATE TABLE holt_briefings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES holt_accounts(id) ON DELETE CASCADE,
  gcal_event_id       TEXT NOT NULL,
  gcal_calendar_id    TEXT NOT NULL DEFAULT 'primary',
  -- Event snapshot at time of briefing (event may change after; we keep what we used)
  event_summary       TEXT,
  event_description   TEXT,
  event_location      TEXT,
  event_start_at      TIMESTAMPTZ NOT NULL,
  event_end_at        TIMESTAMPTZ,
  external_attendees  JSONB NOT NULL DEFAULT '[]'::JSONB, -- [{email, name?, company?, role?}]
  -- Decision: do we brief this meeting?
  decision            TEXT NOT NULL CHECK (decision IN (
    'pending',         -- not yet decided
    'briefable',       -- external attendees present, will brief
    'skipped_internal',-- all attendees internal
    'skipped_solo',    -- focus block / no attendees
    'skipped_declined' -- user declined the event
  )) DEFAULT 'pending',
  -- Variants of the briefing email
  evening_sent_at     TIMESTAMPTZ,                       -- when we sent the "tomorrow's meetings" digest
  prebrief_sent_at    TIMESTAMPTZ,                       -- when we sent the "2h before" deep dive
  -- The actual brief
  briefing_markdown   TEXT,                              -- what we sent / what we'd send
  research_json       JSONB,                             -- raw research artifacts per attendee (URLs, snippets)
  generated_at        TIMESTAMPTZ,
  generate_model      TEXT,
  generate_error      TEXT,
  resend_email_id     TEXT,                              -- last Resend id (most recent send)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, gcal_event_id)
);

CREATE INDEX idx_holt_briefings_event_window     ON holt_briefings(account_id, event_start_at);
CREATE INDEX idx_holt_briefings_decision         ON holt_briefings(account_id, decision, event_start_at);
CREATE INDEX idx_holt_briefings_pending_prebrief ON holt_briefings(event_start_at) WHERE decision = 'briefable' AND prebrief_sent_at IS NULL;
CREATE INDEX idx_holt_briefings_pending_evening  ON holt_briefings(event_start_at) WHERE decision = 'briefable' AND evening_sent_at IS NULL;

CREATE TABLE holt_settings (
  account_id              UUID PRIMARY KEY REFERENCES holt_accounts(id) ON DELETE CASCADE,
  internal_domains        TEXT[] NOT NULL DEFAULT '{}',  -- everything @gb2gllc.com is "internal"; populated from account email on first install
  evening_digest_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  evening_digest_local_hour INTEGER NOT NULL DEFAULT 21 CHECK (evening_digest_local_hour BETWEEN 0 AND 23),
  prebrief_minutes_before INTEGER NOT NULL DEFAULT 120 CHECK (prebrief_minutes_before BETWEEN 15 AND 720),
  enable_web_research     BOOLEAN NOT NULL DEFAULT TRUE,
  voice_notes             TEXT,                          -- free-text guidance for the brief tone
  delivery_email          TEXT,                          -- defaults to account email; can override (e.g. forward to admin)
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE holt_accounts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE holt_briefings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE holt_settings   ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON holt_accounts  FOR ALL USING (false);
CREATE POLICY "service role only" ON holt_briefings FOR ALL USING (false);
CREATE POLICY "service role only" ON holt_settings  FOR ALL USING (false);
