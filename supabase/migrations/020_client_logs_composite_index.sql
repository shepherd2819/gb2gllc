-- ============================================================
-- 020_client_logs_composite_index.sql
-- ============================================================
-- Composite index on client_logs(client_id, created_at DESC) speeds up the
-- "recent logs for one client" query that Wren's anchor.ts runs on every
-- inbound support email (findClientForSender → SELECT created_at, message
-- FROM client_logs WHERE client_id = $1 ORDER BY created_at DESC LIMIT 5).
--
-- The existing client_logs_client_id_idx is on (client_id) alone, which
-- forces a re-sort of every result set. The composite makes the recent-logs
-- query an index-only ordered scan.
--
-- We deliberately leave the single-column client_id index in place — the
-- redundancy is small, and dropping it would require coordinating with any
-- other queries that filter on client_id without ordering.

CREATE INDEX idx_client_logs_client_id_created_at
  ON client_logs(client_id, created_at DESC);
