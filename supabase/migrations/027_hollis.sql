-- ============================================================
-- 027_hollis.sql — Hollis (inbound AI phone receptionist)
-- ============================================================
-- Per-client. One hollis_lines row per client phone number. One hollis_calls
-- row per call (idempotent on retell_call_id). hollis_kb holds per-client FAQ.
-- The realtime audio loop is hosted by Retell; this schema holds config +
-- outcomes. Access funnels through supabaseAdmin; scope every query by client_id.

CREATE TABLE hollis_lines (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  phone_number       TEXT NOT NULL UNIQUE,        -- E.164
  retell_agent_id    TEXT,
  retell_number_id   TEXT,

  voice_profile      TEXT NOT NULL DEFAULT 'female'
                       CHECK (voice_profile IN ('female','male')),
  agent_name         TEXT NOT NULL DEFAULT 'Ava',
  voice_id           TEXT,
  greeting_override  TEXT,
  persona            JSONB NOT NULL DEFAULT '{}'::jsonb,
  hours              JSONB NOT NULL DEFAULT '{}'::jsonb,
  services           JSONB NOT NULL DEFAULT '[]'::jsonb,
  escalation_number  TEXT,
  booking_mode       TEXT NOT NULL DEFAULT 'email'
                       CHECK (booking_mode IN ('email','crm','both')),
  booking_email      TEXT,
  crm_config         JSONB NOT NULL DEFAULT '{}'::jsonb,
  recording_enabled  BOOLEAN NOT NULL DEFAULT TRUE,

  status             TEXT NOT NULL DEFAULT 'provisioning'
                       CHECK (status IN ('provisioning','active','paused','released')),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE hollis_calls (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id             UUID NOT NULL REFERENCES hollis_lines(id) ON DELETE CASCADE,
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  retell_call_id      TEXT NOT NULL UNIQUE,
  direction           TEXT NOT NULL DEFAULT 'inbound'
                        CHECK (direction IN ('inbound','outbound')),
  caller_number       TEXT,
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  duration_ms         INTEGER,
  end_reason          TEXT,

  transcript          JSONB,
  summary             TEXT,
  sentiment           TEXT,
  outcome             TEXT NOT NULL DEFAULT 'no_action'
                        CHECK (outcome IN (
                          'booked','booking_request','qualified_lead',
                          'message','transfer','no_action'
                        )),
  captured            JSONB NOT NULL DEFAULT '{}'::jsonb,

  disclosure_at        TIMESTAMPTZ,
  recording_consent_at TIMESTAMPTZ,
  recording_url        TEXT,

  ticket_id           UUID REFERENCES tickets(id) ON DELETE SET NULL,
  latency_ms_p50      INTEGER,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE hollis_kb (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hollis_lines_client    ON hollis_lines(client_id);
CREATE INDEX idx_hollis_calls_client    ON hollis_calls(client_id, created_at DESC);
CREATE INDEX idx_hollis_calls_line      ON hollis_calls(line_id, created_at DESC);
CREATE INDEX idx_hollis_calls_followup  ON hollis_calls(client_id, created_at DESC)
  WHERE outcome IN ('booking_request','message','transfer');
CREATE INDEX idx_hollis_kb_client       ON hollis_kb(client_id);

ALTER TABLE hollis_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE hollis_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE hollis_kb    ENABLE ROW LEVEL SECURITY;
CREATE POLICY hollis_lines_service_role_only ON hollis_lines FOR ALL USING (false);
CREATE POLICY hollis_calls_service_role_only ON hollis_calls FOR ALL USING (false);
CREATE POLICY hollis_kb_service_role_only    ON hollis_kb    FOR ALL USING (false);
