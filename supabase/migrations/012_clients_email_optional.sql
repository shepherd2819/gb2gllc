-- ============================================================
-- 012_clients_email_optional.sql — Allow draft clients without an email
-- ============================================================
--
-- The unique constraint stays: Postgres treats NULL as distinct in UNIQUE
-- indexes, so multiple draft clients (all NULL email) coexist fine, while
-- two real emails still collide.

ALTER TABLE clients
  ALTER COLUMN email DROP NOT NULL;

COMMENT ON COLUMN clients.email IS
  'Login + contact email. NULL allowed for draft clients created before their email is known. Once set, the workos invitation flow fills in workos_user_id.';
