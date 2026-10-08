-- Migration 045: link each unofficial WhatsApp number to a responsible consultant
-- and (optionally) to a pipeline stage where new conversations land as deals.

ALTER TABLE unofficial_wa_instances
  ADD COLUMN IF NOT EXISTS owner_user_id     uuid REFERENCES auth.users(id)       ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pipeline_id       uuid REFERENCES pipelines(id)        ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pipeline_stage_id uuid REFERENCES pipeline_stages(id)  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_unofficial_instance
  ON conversations(unofficial_instance_id);
