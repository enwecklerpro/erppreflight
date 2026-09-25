-- ==============================================================================
-- ERP Preflight — Scheduled Preflights Recurring Architecture
-- Migration: 009_scheduled_preflights.sql
-- Specifications: Part 17.16 & Section 31 (Scheduled Automated Preflights)
-- Features: BullMQ repeatable cron patterns, project scoping, target releases,
--           execution history tracking, and Row-Level Security (RLS).
-- ==============================================================================

-- 1. Scheduled Preflights Table
CREATE TABLE IF NOT EXISTS scheduled_preflights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    cron_expression VARCHAR(100) NOT NULL, -- Standard 5-part cron syntax
    engine_types JSONB NOT NULL DEFAULT '["OPD_GUARD", "FORM_DOCTOR", "CLEAN_CORE_OBJECT_GUARD"]',
    target_release VARCHAR(50) NOT NULL DEFAULT 'S4H_2023',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, PAUSED, CANCELLED
    repeat_job_key VARCHAR(255),
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Row Level Security for Scheduled Preflights
ALTER TABLE scheduled_preflights ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_preflights FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_scheduled_preflights ON scheduled_preflights;
CREATE POLICY tenant_isolation_scheduled_preflights ON scheduled_preflights
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

-- 3. Query Performance Indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_preflights_org ON scheduled_preflights(organization_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_preflights_proj ON scheduled_preflights(project_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_preflights_status ON scheduled_preflights(status);
