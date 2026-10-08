-- Migration 046: WhatsApp groups via the unofficial API.
-- A group is one conversation (group_jid) and each incoming message records who wrote it.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS group_jid text;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender_label text,
  ADD COLUMN IF NOT EXISTS sender_jid   text;

CREATE INDEX IF NOT EXISTS idx_conversations_group_jid
  ON conversations(account_id, group_jid) WHERE group_jid IS NOT NULL;
