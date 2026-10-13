-- Migration 049: Google Gemini as a third AI provider, and a separate (cheaper)
-- model for the alert analysis.

ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check CHECK (provider IN ('openai', 'anthropic', 'google'));

ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check CHECK (provider IN ('openai', 'anthropic', 'google'));

-- Optional model used only by the alert analysis (same provider and key as the AI agent).
-- NULL = use the same model as the AI agent.
ALTER TABLE alert_settings
  ADD COLUMN IF NOT EXISTS ai_model text;
