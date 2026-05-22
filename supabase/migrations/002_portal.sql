-- ============================================================
-- 002_portal.sql — Client portal tables
-- ============================================================

-- Clients (auto-created on intake submission)
CREATE TABLE clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_user_id  TEXT UNIQUE,
  intake_session_id TEXT REFERENCES intake_sessions(id),
  name            TEXT,
  email           TEXT UNIQUE NOT NULL,
  company         TEXT,
  invited_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Which products each client has active (John toggles these)
CREATE TABLE client_products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  product     TEXT NOT NULL CHECK (product IN ('herald', 'atrium', 'steward')),
  active      BOOLEAN DEFAULT true,
  started_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, product)
);

-- Herald metrics (updated by webhook or manually by John)
CREATE TABLE herald_metrics (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  messages_answered   INTEGER DEFAULT 0,
  hours_saved         NUMERIC(10,2) DEFAULT 0,
  tasks_completed     INTEGER DEFAULT 0,
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Steward metrics
CREATE TABLE steward_metrics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tasks_completed  INTEGER DEFAULT 0,
  hours_saved      NUMERIC(10,2) DEFAULT 0,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Atrium build progress (John posts updates here)
CREATE TABLE atrium_progress (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  stage       INTEGER NOT NULL,         -- 1-5
  label       TEXT NOT NULL,            -- e.g. "Wireframe complete"
  note        TEXT,                     -- optional detail for client
  completed   BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Support tickets
CREATE TABLE tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- RLS: all portal tables locked to service role only (portal API routes use supabaseAdmin)
ALTER TABLE clients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_products   ENABLE ROW LEVEL SECURITY;
ALTER TABLE herald_metrics    ENABLE ROW LEVEL SECURITY;
ALTER TABLE steward_metrics   ENABLE ROW LEVEL SECURITY;
ALTER TABLE atrium_progress   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets           ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only" ON clients           FOR ALL USING (false);
CREATE POLICY "service role only" ON client_products   FOR ALL USING (false);
CREATE POLICY "service role only" ON herald_metrics    FOR ALL USING (false);
CREATE POLICY "service role only" ON steward_metrics   FOR ALL USING (false);
CREATE POLICY "service role only" ON atrium_progress   FOR ALL USING (false);
CREATE POLICY "service role only" ON tickets           FOR ALL USING (false);
