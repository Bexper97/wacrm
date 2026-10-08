-- Migration 047: remember when a message was deleted on the phone.
-- The row and its content are kept (the CRM is a record); this only flags it.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
