-- ==============================================================================
-- ERP Preflight — Analyze experience, Problem Router, Full Project Preflight
-- Migration: 018_analysis_orchestration.sql
-- Specifications: Part 01 §1.4–§1.6, Part 03 §3.8, Part 05 §5.1 / §5.6,
--                 section C §15 / §16 (analysis launcher + backend).
--
-- 1. Project mode context (Part 01 §1.5): source ERP/version, target product /
--    edition, countries, modules, deployment type. target_release already exists.
-- 2. Analysis progress + orchestration metadata on analyses (kind, current stage,
--    stage snapshot, full-preflight plan/summary, problem statement, routing link).
-- 3. analysis_progress_events: append-only per-analysis stage log (SSE source).
-- 4. problem_routings: persisted AI Problem Router decisions (advisory only; a
--    routing never creates findings).
-- Every new tenant table: organization_id + ENABLE/FORCE RLS + tenant policy +
-- grants for the non-privileged runtime role erppreflight_app (migration 010).
-- ==============================================================================

-- 1. Project context ------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_erp VARCHAR(80);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_version VARCHAR(80);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_product VARCHAR(80);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_edition VARCHAR(80);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deployment_type VARCHAR(40);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS countries JSONB NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS modules JSONB NOT NULL DEFAULT '[]';

-- 2. Analysis progress / orchestration -----------------------------------------
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS kind VARCHAR(30) NOT NULL DEFAULT 'STANDARD';
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS current_stage VARCHAR(40);
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{}';
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS orchestration JSONB NOT NULL DEFAULT '{}';
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS problem_statement TEXT;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS routing_id UUID;

CREATE INDEX IF NOT EXISTS idx_analyses_org_kind ON analyses(organization_id, kind, created_at DESC);

-- 3. Analysis progress events ---------------------------------------------------
CREATE TABLE IF NOT EXISTS analysis_progress_events (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    stage VARCHAR(40) NOT NULL,
    status VARCHAR(20) NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_progress_stage CHECK (stage IN (
        'UPLOAD_VALIDATED', 'PARSING', 'RUNNING_RULES', 'MATCHING_EVIDENCE', 'GENERATING_TESTS', 'FINALIZING'
    )),
    CONSTRAINT chk_progress_status CHECK (status IN ('STARTED', 'PROGRESS', 'COMPLETED', 'FAILED', 'SKIPPED'))
);

CREATE INDEX IF NOT EXISTS idx_analysis_progress_events_analysis
    ON analysis_progress_events(analysis_id, id);
CREATE INDEX IF NOT EXISTS idx_analysis_progress_events_org
    ON analysis_progress_events(organization_id);

ALTER TABLE analysis_progress_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_progress_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_analysis_progress_events ON analysis_progress_events;
CREATE POLICY tenant_isolation_analysis_progress_events ON analysis_progress_events
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 4. Problem router decisions ---------------------------------------------------
CREATE TABLE IF NOT EXISTS problem_routings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    problem_text TEXT NOT NULL,
    object_identifier VARCHAR(200),
    classifier_version VARCHAR(40) NOT NULL,
    context JSONB NOT NULL DEFAULT '{}',
    suggestions JSONB NOT NULL DEFAULT '[]',
    ai_refinement JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_problem_routings_org ON problem_routings(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_problem_routings_project ON problem_routings(project_id);

ALTER TABLE problem_routings ENABLE ROW LEVEL SECURITY;
ALTER TABLE problem_routings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_problem_routings ON problem_routings;
CREATE POLICY tenant_isolation_problem_routings ON problem_routings
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 5. Runtime role grants (migration 010 sets default privileges; explicit for clarity)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erppreflight_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON analysis_progress_events TO erppreflight_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON problem_routings TO erppreflight_app;
        GRANT USAGE, SELECT, UPDATE ON SEQUENCE analysis_progress_events_id_seq TO erppreflight_app;
    END IF;
END $$;
