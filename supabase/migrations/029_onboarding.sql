-- ============================================================
-- 029_onboarding.sql — Onboard (enterprise client onboarding)
-- ============================================================
-- Journey state machine + milestones + append-only audit, plus column adds
-- that wire clients <-> contracts <-> billing <-> WorkOS orgs <-> roles.
-- All access via supabaseAdmin; scope every query by client_id / journey_id.

CREATE TABLE onboarding_journeys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  template        TEXT NOT NULL DEFAULT 'standard',
  tier            TEXT NOT NULL DEFAULT 'self_serve'
                    CHECK (tier IN ('self_serve','assisted','white_glove')),
  stage           TEXT NOT NULL DEFAULT 'invited' CHECK (stage IN (
                    'invited','kickoff_scheduled','provisioning','activated','adopted','complete','stalled'
                  )),
  owner_csm       TEXT,
  ttv_target_at   TIMESTAMPTZ,
  activated_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE onboarding_milestones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id    UUID NOT NULL REFERENCES onboarding_journeys(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  title         TEXT NOT NULL,
  owner         TEXT NOT NULL DEFAULT 'client' CHECK (owner IN ('client','gb2g')),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','in_progress','done','blocked','skipped')),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  due_at        TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, key)
);

CREATE TABLE onboarding_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id    UUID REFERENCES onboarding_journeys(id) ON DELETE CASCADE,
  client_id     UUID REFERENCES clients(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  actor         TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Column adds that connect the islands (additive; safe even if used in later phases).
ALTER TABLE clients         ADD COLUMN IF NOT EXISTS workos_org_id TEXT UNIQUE;
ALTER TABLE client_members  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'
                              CHECK (role IN ('owner','admin','member','billing','read_only'));
ALTER TABLE contracts       ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT;

-- Widen client_products to match contracts (which already allows 'custom').
ALTER TABLE client_products DROP CONSTRAINT IF EXISTS client_products_product_check;
ALTER TABLE client_products ADD CONSTRAINT client_products_product_check
  CHECK (product IN ('herald','atrium','steward','custom'));

CREATE INDEX idx_onb_journeys_stage      ON onboarding_journeys(stage, updated_at DESC);
CREATE INDEX idx_onb_journeys_ttv        ON onboarding_journeys(ttv_target_at) WHERE stage NOT IN ('complete','adopted');
CREATE INDEX idx_onb_milestones_journey  ON onboarding_milestones(journey_id, sort_order);
CREATE INDEX idx_onb_events_client       ON onboarding_events(client_id, created_at DESC);

ALTER TABLE onboarding_journeys   ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_events     ENABLE ROW LEVEL SECURITY;
CREATE POLICY onb_journeys_service_role_only   ON onboarding_journeys   FOR ALL USING (false);
CREATE POLICY onb_milestones_service_role_only ON onboarding_milestones FOR ALL USING (false);
CREATE POLICY onb_events_service_role_only     ON onboarding_events     FOR ALL USING (false);
