-- Migration 048: conversation alerts (unanswered conversations + AI-flagged suspicious content),
-- the scan bookkeeping, and per-account alert settings. Only admins can read or change them.

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('unanswered', 'suspicious')),
  -- suspicious only: personal_contact | off_platform_payment | unauthorized_promise
  --                  | aggressive_tone | complaint | off_topic
  category        text,
  severity        text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  reason          text NOT NULL,
  excerpt         text,
  message_id      uuid REFERENCES messages(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'false_positive')),
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Makes a re-scan idempotent: the same finding is never inserted twice.
  dedupe_key      text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_account_status
  ON conversation_alerts(account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_conversation
  ON conversation_alerts(conversation_id);

ALTER TABLE conversation_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alerts_select ON conversation_alerts;
DROP POLICY IF EXISTS alerts_update ON conversation_alerts;
CREATE POLICY alerts_select ON conversation_alerts FOR SELECT
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY alerts_update ON conversation_alerts FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
-- No INSERT/DELETE policy: rows are written by the server (service role) only.

-- ---------------------------------------------------------------------------
-- Which conversation state the AI already analysed (so each message is read once)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_alert_scans (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  last_message_at timestamptz,
  scanned_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE conversation_alert_scans ENABLE ROW LEVEL SECURITY;
-- Server-only table: no policies for authenticated users.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_settings (
  account_id          uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  unanswered_minutes  integer NOT NULL DEFAULT 60 CHECK (unanswered_minutes BETWEEN 5 AND 1440),
  ai_scan_enabled     boolean NOT NULL DEFAULT true,
  summary_enabled     boolean NOT NULL DEFAULT false,
  summary_phone       text,
  summary_instance_id uuid REFERENCES unofficial_wa_instances(id) ON DELETE SET NULL,
  summary_hour        integer NOT NULL DEFAULT 18 CHECK (summary_hour BETWEEN 0 AND 23),
  last_summary_on     date,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE alert_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alert_settings_select ON alert_settings;
DROP POLICY IF EXISTS alert_settings_write ON alert_settings;
CREATE POLICY alert_settings_select ON alert_settings FOR SELECT
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY alert_settings_write ON alert_settings FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ---------------------------------------------------------------------------
-- AI usage log: allow the new "alert_scan" mode so scan cost is visible
-- ---------------------------------------------------------------------------
ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check CHECK (mode IN ('auto_reply', 'draft', 'alert_scan'));
