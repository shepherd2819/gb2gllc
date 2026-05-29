-- ============================================================
-- 021_vera_contracts.sql — Vera (contract generation + signing agent)
-- ============================================================
-- Admin-only. One row per generated contract. Tokens are random 32-byte
-- URL-safe strings (no enumeration). Signed PDFs land in Supabase Storage
-- under vera/<contract_id>/. The contracts Notion DB stores the human-
-- readable record. All state lives in this table.

CREATE TABLE contracts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  product              TEXT NOT NULL CHECK (product IN ('herald','atrium','steward','custom')),
  amount_cents         INTEGER NOT NULL,
  cadence              TEXT NOT NULL CHECK (cadence IN ('monthly','one_time','hourly')),
  scope_notes          TEXT,

  template_version     TEXT,
  token                TEXT NOT NULL UNIQUE,
  expires_at           TIMESTAMPTZ NOT NULL,

  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','sent','signed','voided','expired'
  )),

  sent_at              TIMESTAMPTZ,
  viewed_at            TIMESTAMPTZ,
  reminder_sent_at     TIMESTAMPTZ,
  signed_at            TIMESTAMPTZ,
  voided_at            TIMESTAMPTZ,
  voided_reason        TEXT,

  signer_name          TEXT,
  signer_representing  TEXT,
  signer_ip            TEXT,
  signer_user_agent    TEXT,

  notion_page_id       TEXT,
  unsigned_pdf_path    TEXT,
  signed_pdf_path      TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contracts_client_created     ON contracts(client_id, created_at DESC);
CREATE INDEX idx_contracts_status             ON contracts(status, sent_at DESC);
CREATE INDEX idx_contracts_pending_reminder   ON contracts(sent_at)    WHERE status = 'sent' AND reminder_sent_at IS NULL;
CREATE INDEX idx_contracts_pending_expiry     ON contracts(expires_at) WHERE status = 'sent';

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contracts_service_role_only ON contracts FOR ALL USING (false);
