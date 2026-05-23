-- ============================================================
-- 008_chatbot_agent_name.sql — Admin-customizable display name for client's Herald agent
-- ============================================================

ALTER TABLE clients
  ADD COLUMN chatbot_agent_name TEXT;

COMMENT ON COLUMN clients.chatbot_agent_name IS
  'Friendly display name for the client''s Herald (chatbot.com) agent. Admin-editable only. Shown on dashboard + in digest emails. Falls back to "Herald" when null.';
