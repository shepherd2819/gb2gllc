-- ============================================================
-- 028_hollis_demo.sql — Hollis public web-call demo (rate limiting)
-- ============================================================
-- One row per demo web call started, keyed loosely by IP, for soft per-IP
-- daily rate limiting of the public "talk to Hollis" demo. Cost protection is
-- layered: this IP limit + the demo agent's max_call_duration set in Retell.

CREATE TABLE hollis_demo_calls (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip          TEXT,
  call_id     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hollis_demo_calls_ip ON hollis_demo_calls(ip, created_at DESC);

ALTER TABLE hollis_demo_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY hollis_demo_calls_service_role_only ON hollis_demo_calls FOR ALL USING (false);
