-- ==============================================================================
-- ERP Preflight — API Change Guard stored baselines
-- Migration: 023_api_change_baselines.sql
-- Specifications: Part 07 (API Change Guard: baseline vs. candidate comparison), Part 04 §4.10 (reproducible
--   findings: the exact baseline bytes and hash a comparison used), AGENTS.md §4.4 (tenant isolation).
--
-- A baseline is an immutable copy of an OpenAPI 2/3 or OData EDMX specification, taken from a CLEAN project
-- artifact and stored under tenants/{org}/projects/{project}/api-baselines/{id}/… in the clean bucket (the
-- source upload may be purged by retention; the baseline copy is not). At most one baseline per project is
-- ACTIVE: API_CHANGE_GUARD analyses compare the new specification against the explicitly selected baseline
-- or, by default, the active one.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS api_baselines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    format VARCHAR(20) NOT NULL CHECK (format IN ('OPENAPI', 'EDMX')),
    spec_version VARCHAR(40),
    version VARCHAR(100) NOT NULL,
    sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    storage_key VARCHAR(1024) NOT NULL,
    source_file_id UUID REFERENCES uploaded_files(id) ON DELETE SET NULL,
    source_file_name VARCHAR(500),
    api_title VARCHAR(300),
    surface JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    UNIQUE (organization_id, project_id, name, version)
);

CREATE INDEX IF NOT EXISTS idx_api_baselines_org_project ON api_baselines(organization_id, project_id, created_at DESC);
-- At most one active baseline per project.
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_baselines_active
    ON api_baselines(organization_id, project_id) WHERE is_active;

ALTER TABLE api_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_baselines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_api_baselines ON api_baselines;
CREATE POLICY tenant_isolation_api_baselines ON api_baselines FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON api_baselines TO erppreflight_app;
