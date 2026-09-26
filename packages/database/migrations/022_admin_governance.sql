-- ==============================================================================
-- ERP Preflight — Platform governance: Rule Admin, AI Admin, Source Sync Admin
-- Migration: 022_admin_governance.sql
-- Specifications: Part 10 §10.10 (Rule Admin: engine, rule id, version, status,
--   tests, coverage, author, reviewer; publishing requires tests to pass),
--   §10.11 (AI Admin: per task primary model, fallback, max tokens, temperature,
--   provider, privacy mode, cost ceiling; global kill switch per provider),
--   §10.12 (Source Sync Admin: freshness, errors, retry; alert when a critical
--   knowledge source becomes stale), Part 17 (AI governance, finding immutability).
--
-- Scope model (same as feature_flags, migration 012):
--   * All tables are PLATFORM-level configuration / history. None carries an
--     organization_id, so none holds tenant data and no tenant RLS policy applies.
--   * They are written only by SUPER_ADMIN endpoints and platform jobs through
--     the login (schema-owner) pool. The tenant runtime role erppreflight_app
--     (migration 010) can read the configuration tables but never write them,
--     so a tenant-scoped transaction can neither flip an AI kill switch nor
--     publish a rule.
--   * History tables (rule_governance_events, rule_self_test_runs) are
--     append-only: UPDATE and DELETE are rejected by triggers.
--
-- Governance state is metadata. It never changes engine output: engines stay
-- deterministic and persisted findings keep the rule version that produced them
-- (Part 04 §4.10). A published rule whose catalog version changes is shown as
-- drifted until it is re-tested and re-published.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Rule governance (§10.10)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rule_self_test_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_code VARCHAR(120) NOT NULL CHECK (rule_code ~ '^[A-Z0-9_]{3,120}$'),
    engine_type VARCHAR(64) NOT NULL,
    rule_version VARCHAR(80) NOT NULL,
    engine_version VARCHAR(40),
    manifest_version VARCHAR(40),
    status VARCHAR(20) NOT NULL CHECK (status IN ('PASSED', 'FAILED', 'NO_FIXTURES', 'ERROR')),
    passed BOOLEAN NOT NULL,
    coverage_gap VARCHAR(40),
    positive_count INTEGER NOT NULL DEFAULT 0 CHECK (positive_count >= 0),
    negative_count INTEGER NOT NULL DEFAULT 0 CHECK (negative_count >= 0),
    result_digest CHAR(64),
    cases JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(cases) = 'array'),
    duration_ms INTEGER,
    run_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_rule_self_test_passed CHECK (passed = (status = 'PASSED'))
);
CREATE INDEX IF NOT EXISTS idx_rule_self_test_runs_rule ON rule_self_test_runs(rule_code, created_at DESC);

CREATE TABLE IF NOT EXISTS rule_governance (
    rule_code VARCHAR(120) PRIMARY KEY CHECK (rule_code ~ '^[A-Z0-9_]{3,120}$'),
    engine_type VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'DEPRECATED')),
    author VARCHAR(200),
    reviewer VARCHAR(200),
    notes TEXT CHECK (notes IS NULL OR length(notes) <= 4000),
    published_version VARCHAR(80),
    published_at TIMESTAMPTZ,
    published_by UUID REFERENCES users(id) ON DELETE SET NULL,
    published_self_test_id UUID REFERENCES rule_self_test_runs(id),
    deprecated_at TIMESTAMPTZ,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A published rule always points at the passing self-test that allowed it.
    CONSTRAINT chk_rule_governance_published CHECK (
        status <> 'PUBLISHED' OR (published_version IS NOT NULL AND published_self_test_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_rule_governance_engine ON rule_governance(engine_type, status);

CREATE TABLE IF NOT EXISTS rule_governance_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_code VARCHAR(120) NOT NULL,
    engine_type VARCHAR(64) NOT NULL,
    event_type VARCHAR(30) NOT NULL
        CHECK (event_type IN ('UPDATED', 'TRANSITION', 'SELF_TEST', 'PUBLISH_BLOCKED')),
    from_status VARCHAR(20),
    to_status VARCHAR(20),
    rule_version VARCHAR(80),
    self_test_id UUID REFERENCES rule_self_test_runs(id),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_email VARCHAR(320),
    note VARCHAR(1000),
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rule_governance_events_rule ON rule_governance_events(rule_code, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_governance_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rule_self_test_runs_immutable ON rule_self_test_runs;
CREATE TRIGGER trg_rule_self_test_runs_immutable
    BEFORE UPDATE OR DELETE ON rule_self_test_runs
    FOR EACH ROW EXECUTE FUNCTION prevent_governance_history_mutation();

DROP TRIGGER IF EXISTS trg_rule_governance_events_immutable ON rule_governance_events;
CREATE TRIGGER trg_rule_governance_events_immutable
    BEFORE UPDATE OR DELETE ON rule_governance_events
    FOR EACH ROW EXECUTE FUNCTION prevent_governance_history_mutation();

-- ------------------------------------------------------------------------------
-- 2. AI governance (§10.11)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_task_configs (
    task_type VARCHAR(64) PRIMARY KEY CHECK (task_type ~ '^[a-z][a-z0-9_]{2,63}$'),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    -- NULL provider = platform default (AI_DEFAULT_PROVIDER).
    provider VARCHAR(32) CHECK (provider IS NULL OR provider IN ('ANTHROPIC', 'OPENAI', 'OLLAMA_LOCAL')),
    primary_model VARCHAR(120),
    fallback_provider VARCHAR(32)
        CHECK (fallback_provider IS NULL OR fallback_provider IN ('ANTHROPIC', 'OPENAI', 'OLLAMA_LOCAL')),
    fallback_model VARCHAR(120),
    max_tokens INTEGER NOT NULL DEFAULT 512 CHECK (max_tokens BETWEEN 64 AND 4096),
    temperature NUMERIC(3,2) CHECK (temperature IS NULL OR temperature BETWEEN 0 AND 2),
    privacy_mode VARCHAR(20) NOT NULL DEFAULT 'STANDARD' CHECK (privacy_mode IN ('STANDARD', 'SELF_HOSTED_ONLY')),
    -- NULL = no ceiling. Spend is computed from the token prices below (EUR per 1,000 tokens).
    cost_ceiling_eur_monthly NUMERIC(12,2) CHECK (cost_ceiling_eur_monthly IS NULL OR cost_ceiling_eur_monthly >= 0),
    input_price_eur_per_1k NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (input_price_eur_per_1k >= 0),
    output_price_eur_per_1k NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (output_price_eur_per_1k >= 0),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_provider_controls (
    provider VARCHAR(32) PRIMARY KEY CHECK (provider IN ('ANTHROPIC', 'OPENAI', 'OLLAMA_LOCAL')),
    kill_switch BOOLEAN NOT NULL DEFAULT FALSE,
    kill_reason VARCHAR(500),
    killed_at TIMESTAMPTZ,
    -- Self-hosted OpenAI-compatible endpoint (OLLAMA_LOCAL only); overrides OLLAMA_BASE_URL.
    endpoint_url VARCHAR(500) CHECK (endpoint_url IS NULL OR endpoint_url ~ '^https?://[^\s@]+$'),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_ai_provider_endpoint_self_hosted CHECK (endpoint_url IS NULL OR provider = 'OLLAMA_LOCAL')
);

-- Monthly spend per task / provider / model, maintained by the AI gateway after each call
-- (cost ceiling enforcement, §10.6 AI spend). blocked_requests counts calls refused by a
-- kill switch, a disabled task or the ceiling.
CREATE TABLE IF NOT EXISTS ai_task_spend (
    task_type VARCHAR(64) NOT NULL,
    period_month DATE NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
    provider VARCHAR(32) NOT NULL,
    model VARCHAR(120) NOT NULL DEFAULT '',
    requests INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
    blocked_requests INTEGER NOT NULL DEFAULT 0 CHECK (blocked_requests >= 0),
    input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    cost_eur NUMERIC(14,6) NOT NULL DEFAULT 0 CHECK (cost_eur >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_type, period_month, provider, model)
);

-- ------------------------------------------------------------------------------
-- 3. Knowledge source sync governance (§10.12)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_source_settings (
    adapter_id VARCHAR(64) PRIMARY KEY CHECK (adapter_id ~ '^[A-Z0-9_]{3,64}$'),
    critical BOOLEAN NOT NULL DEFAULT FALSE,
    freshness_threshold_hours INTEGER NOT NULL DEFAULT 192 CHECK (freshness_threshold_hours BETWEEN 1 AND 8760),
    alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_source_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adapter_id VARCHAR(64) NOT NULL,
    alert_type VARCHAR(20) NOT NULL DEFAULT 'STALE' CHECK (alert_type IN ('STALE')),
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
    severity VARCHAR(20) NOT NULL DEFAULT 'CRITICAL'
        CHECK (severity IN ('BLOCKER', 'CRITICAL', 'MAJOR', 'MEDIUM', 'MINOR', 'LOW', 'INFO')),
    last_success_at TIMESTAMPTZ,
    threshold_hours INTEGER NOT NULL,
    age_hours NUMERIC(12,2),
    message VARCHAR(1000) NOT NULL,
    notified_users INTEGER NOT NULL DEFAULT 0,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved_reason VARCHAR(200),
    CHECK ((status = 'OPEN') = (resolved_at IS NULL))
);
-- At most one open alert per source and type: the freshness check is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_source_alert_open
    ON knowledge_source_alerts(adapter_id, alert_type) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_knowledge_source_alerts_opened ON knowledge_source_alerts(opened_at DESC);

-- ------------------------------------------------------------------------------
-- 4. Grants for the RLS runtime role (feature_flags pattern, migration 012)
--    Default privileges from 010 grant DML on new tables; platform governance is
--    read-only for the runtime role and history is never readable/writable by it.
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erppreflight_app') THEN
        GRANT SELECT ON rule_governance, ai_task_configs, ai_provider_controls, knowledge_source_settings
            TO erppreflight_app;
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON rule_governance, ai_task_configs, ai_provider_controls,
            knowledge_source_settings FROM erppreflight_app;
        REVOKE ALL ON rule_self_test_runs, rule_governance_events, ai_task_spend, knowledge_source_alerts
            FROM erppreflight_app;
    END IF;
END $$;
