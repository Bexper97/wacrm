-- Migration 044: Unofficial WhatsApp instances
-- Stores multi-number connections for the unofficial WhatsApp API (Evolution API / Baileys).
-- One row per WhatsApp number, scoped to an account. instance_name is the key
-- used by the Evolution API service; label is the display name shown in the CRM.

CREATE TABLE IF NOT EXISTS unofficial_wa_instances (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instance_name   text        NOT NULL,   -- Evolution API instance identifier
  label           text        NOT NULL,   -- User-defined label e.g. "Vendas", "Suporte"
  phone           text,                   -- Phone number once connected (optional)
  status          text        NOT NULL DEFAULT 'disconnected'
                              CHECK (status IN ('connected', 'disconnected', 'connecting')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_name)
);

-- Row-level security
ALTER TABLE unofficial_wa_instances ENABLE ROW LEVEL SECURITY;

-- Any account member can read their account's instances
CREATE POLICY "account_members_read_unofficial_instances"
  ON unofficial_wa_instances FOR SELECT
  USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

-- Only admins can insert / update / delete
CREATE POLICY "account_admins_manage_unofficial_instances"
  ON unofficial_wa_instances FOR ALL
  USING (
    account_id IN (
      SELECT account_id FROM profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Track which unofficial instance a conversation came through.
-- NULL = official Meta API or unknown; populated by the unofficial webhook.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS unofficial_instance_id uuid
  REFERENCES unofficial_wa_instances(id) ON DELETE SET NULL;
