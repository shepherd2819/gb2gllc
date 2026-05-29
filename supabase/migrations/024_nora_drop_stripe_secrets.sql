-- ============================================================
-- 023_nora_drop_stripe_secrets.sql
-- ============================================================
-- Security tightening: remove Stripe API key + webhook signing secret
-- from the database. Both now live exclusively in Vercel encrypted
-- env vars (NORA_STRIPE_SECRET_KEY, NORA_STRIPE_WEBHOOK_SECRET).
--
-- A DB leak alone can no longer expose Stripe credentials.

ALTER TABLE nora_accounts DROP COLUMN IF EXISTS stripe_secret_key;
ALTER TABLE nora_accounts DROP COLUMN IF EXISTS stripe_webhook_secret;
