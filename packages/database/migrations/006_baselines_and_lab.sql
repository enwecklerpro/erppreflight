-- ==============================================================================
-- ERP Preflight — Project Baselines & Scenario Test Lab Migration
-- Migration: 006_baselines_and_lab.sql
-- Features: Project Baselines, Drift Engine, Synthetic Scenarios & Test Lab
-- ==============================================================================

-- 1. Extend analyses with is_baseline flag
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS is_baseline BOOLEAN NOT NULL DEFAULT false;

-- 2. Extend projects with baseline_analysis_id reference
ALTER TABLE projects ADD COLUMN IF NOT EXISTS baseline_analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL;

-- 3. Synthetic Scenarios (Test Lab & Regression Generator)
CREATE TABLE IF NOT EXISTS synthetic_scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    domain VARCHAR(50) NOT NULL, -- OPD, FORM, MFS, CHANGE_POINTER
    scenario_name VARCHAR(255) NOT NULL,
    failure_type VARCHAR(100) NOT NULL DEFAULT 'CLEAN_PASS',
    payload TEXT NOT NULL,
    expected_findings JSONB NOT NULL DEFAULT '[]',
    last_run_result JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for Synthetic Scenarios
ALTER TABLE synthetic_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_scenarios FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_synthetic_scenarios ON synthetic_scenarios;
CREATE POLICY tenant_isolation_synthetic_scenarios ON synthetic_scenarios
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_scenarios_org ON synthetic_scenarios(organization_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_proj ON synthetic_scenarios(project_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_dom ON synthetic_scenarios(domain);
