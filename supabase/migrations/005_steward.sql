-- ============================================================
-- 005_steward.sql — Steward agent infrastructure
-- ============================================================

-- Platform agent registry (seeded once, managed by system)
CREATE TABLE steward_platform_agents (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  icon         TEXT NOT NULL DEFAULT '🤖',
  description  TEXT NOT NULL,
  available    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO steward_platform_agents (id, display_name, icon, description) VALUES
  ('monday',          'Monday.com',      '📋', 'Manage boards, items, updates, and workflows'),
  ('gmail',           'Gmail',           '✉️',  'Read, draft, send, and organize email'),
  ('slack',           'Slack',           '💬', 'Monitor channels, send messages, and manage reminders'),
  ('notion',          'Notion',          '📝', 'Read, create, and update pages and databases'),
  ('google_calendar', 'Google Calendar', '📅', 'Read and manage calendar events and scheduling'),
  ('hubspot',         'HubSpot',         '🟠', 'Manage contacts, deals, and CRM workflows'),
  ('airtable',        'Airtable',        '🗄️',  'Read and update Airtable bases and records'),
  ('shopify',         'Shopify',         '🛍️',  'Monitor orders, inventory, and customer data'),
  ('quickbooks',      'QuickBooks',      '💼', 'Read invoices, expenses, and financial reports'),
  ('asana',           'Asana',           '✅', 'Manage tasks, projects, and team workflows');

-- Per-client agent assignments: what each agent does + scope enforcement
CREATE TABLE client_steward_assignments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform_agent_id TEXT NOT NULL REFERENCES steward_platform_agents(id),
  mission           TEXT NOT NULL,
  -- Explicit allowed action class names. Empty = all platform actions (mission text enforces scope).
  -- Populated by runtime when agent is deployed; can be manually overridden.
  action_scope      TEXT[] DEFAULT '{}',
  active            BOOLEAN NOT NULL DEFAULT true,
  schedule          TEXT,          -- cron expression; null = manual/webhook only
  last_run_at       TIMESTAMPTZ,
  last_run_status   TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX steward_assignments_client_idx    ON client_steward_assignments(client_id);
CREATE INDEX steward_assignments_platform_idx  ON client_steward_assignments(platform_agent_id);

-- Run records
CREATE TABLE steward_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  assignment_id UUID REFERENCES client_steward_assignments(id) ON DELETE SET NULL,
  trigger       TEXT NOT NULL DEFAULT 'manual',
  status        TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'blocked')),
  input         JSONB DEFAULT '{}',
  summary       TEXT,
  tool_calls    JSONB DEFAULT '[]',
  tokens_used   INTEGER DEFAULT 0,
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  error         TEXT
);

CREATE INDEX steward_runs_client_idx     ON steward_runs(client_id);
CREATE INDEX steward_runs_assignment_idx ON steward_runs(assignment_id);
CREATE INDEX steward_runs_started_idx    ON steward_runs(started_at DESC);

-- Semantic memory — long-term, bitemporal facts per client
CREATE TABLE steward_semantic_facts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  subject       TEXT NOT NULL,    -- e.g. 'preference:communication_style', 'person:email@co.com'
  predicate     TEXT NOT NULL,
  object        TEXT NOT NULL,
  confidence    NUMERIC(3,2) DEFAULT 1.0,
  valid_from    TIMESTAMPTZ DEFAULT NOW(),
  valid_to      TIMESTAMPTZ,      -- null = currently valid
  source_run_id UUID REFERENCES steward_runs(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX steward_facts_client_subject_idx ON steward_semantic_facts(client_id, subject);

-- Episodic events — one row per tool call / run boundary
CREATE TABLE steward_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  run_id     UUID REFERENCES steward_runs(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,       -- 'run_started' | 'tool_call' | 'run_completed' | 'reflection'
  payload    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX steward_events_run_idx    ON steward_events(run_id);
CREATE INDEX steward_events_client_idx ON steward_events(client_id);

-- Playbooks — successful task patterns that feed future runs as few-shot context
CREATE TABLE steward_playbooks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform_agent_id TEXT REFERENCES steward_platform_agents(id),
  task_summary      TEXT NOT NULL,
  approach          TEXT NOT NULL,   -- what the agent did (tool sequence + rationale)
  outcome           TEXT NOT NULL,   -- what happened
  feedback          INTEGER DEFAULT 0 CHECK (feedback IN (-1, 0, 1)),
  run_id            UUID REFERENCES steward_runs(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX steward_playbooks_client_platform_idx ON steward_playbooks(client_id, platform_agent_id);

-- Audit log — HMAC-signed chain; every tool call lands here regardless of outcome
CREATE TABLE steward_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  run_id        UUID REFERENCES steward_runs(id) ON DELETE SET NULL,
  assignment_id UUID REFERENCES client_steward_assignments(id) ON DELETE SET NULL,
  tool_name     TEXT NOT NULL,
  action_class  TEXT,
  input_summary TEXT,
  outcome       TEXT NOT NULL CHECK (outcome IN ('allowed', 'blocked', 'completed', 'failed')),
  reason        TEXT,
  hmac          TEXT NOT NULL,
  prev_entry_id UUID REFERENCES steward_audit_log(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX steward_audit_client_idx  ON steward_audit_log(client_id);
CREATE INDEX steward_audit_run_idx     ON steward_audit_log(run_id);

-- RLS
ALTER TABLE steward_platform_agents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_steward_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE steward_runs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE steward_semantic_facts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE steward_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE steward_playbooks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE steward_audit_log          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON steward_platform_agents    FOR ALL USING (false);
CREATE POLICY "service_role_only" ON client_steward_assignments FOR ALL USING (false);
CREATE POLICY "service_role_only" ON steward_runs               FOR ALL USING (false);
CREATE POLICY "service_role_only" ON steward_semantic_facts     FOR ALL USING (false);
CREATE POLICY "service_role_only" ON steward_events             FOR ALL USING (false);
CREATE POLICY "service_role_only" ON steward_playbooks          FOR ALL USING (false);
CREATE POLICY "service_role_only" ON steward_audit_log          FOR ALL USING (false);
