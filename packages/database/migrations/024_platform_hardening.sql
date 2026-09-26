-- ==============================================================================
-- ERP Preflight — Platform hardening (metering + notification locale)
-- Migration: 024_platform_hardening.sql
--
--   1. usage_events: new metered metric CONNECTOR_REQUEST (outbound requests made by
--      connectors, spec 10.5 usage metering). The CHECK constraint is widened; no row
--      changes. usage_events keeps its RLS (ENABLE + FORCE, tenant policy, migration 012).
--   2. users.preferred_locale: language of e-mail notifications (en | de). NULL = English.
--      users is a global identity table (no organization_id); it is only written for the
--      signed-in user by the API (NotificationsService.setEmailLocale).
-- Idempotent: every statement can run twice.
-- ==============================================================================

ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS chk_usage_metric;
ALTER TABLE usage_events
    ADD CONSTRAINT chk_usage_metric CHECK (metric IN (
        'ANALYSIS_RUN', 'ENGINE_EXECUTION', 'ARTIFACT_UPLOAD', 'ARTIFACT_BYTES', 'REPORT_EXPORT', 'AI_TOKENS',
        'CONNECTOR_REQUEST'
    ));

ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_locale VARCHAR(5);
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_preferred_locale;
ALTER TABLE users
    ADD CONSTRAINT chk_users_preferred_locale CHECK (preferred_locale IS NULL OR preferred_locale IN ('en', 'de'));
