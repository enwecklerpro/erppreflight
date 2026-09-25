-- ==============================================================================
-- ERP Preflight — Analysis Templates, Feedback & Release Notes Migration
-- Migration: 005_templates_and_feedback.sql
-- Features: Analysis Templates, Feedback & Gap Voting, Release Notes & Changelogs
-- ==============================================================================

-- 1. Analysis Templates (Reusable Enterprise Preflight Configurations)
CREATE TABLE IF NOT EXISTS analysis_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    target_domain VARCHAR(100) NOT NULL,
    engines JSONB NOT NULL DEFAULT '[]',
    required_inputs JSONB NOT NULL DEFAULT '[]',
    optional_inputs JSONB NOT NULL DEFAULT '[]',
    standard_checks JSONB NOT NULL DEFAULT '[]',
    report_type VARCHAR(50) NOT NULL DEFAULT 'FULL_ASSESSMENT',
    is_system_template BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for Analysis Templates (allows viewing system templates or tenant's own templates)
ALTER TABLE analysis_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_templates ON analysis_templates;
CREATE POLICY tenant_isolation_templates ON analysis_templates
    FOR ALL
    USING (is_system_template = true OR organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_templates_org ON analysis_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_templates_slug ON analysis_templates(slug);

-- 2. Customer Feedback & Gap Voting (Feature Requests, Accuracy Flags)
CREATE TABLE IF NOT EXISTS customer_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    finding_id UUID REFERENCES findings(id) ON DELETE SET NULL,
    feedback_type VARCHAR(50) NOT NULL DEFAULT 'FEATURE_REQUEST', -- FEATURE_REQUEST, ACCURACY_DISPUTE, GAP_VOTE
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'UNDER_REVIEW', -- UNDER_REVIEW, PLANNED, IN_PROGRESS, SHIPPED, DECLINED
    votes INTEGER NOT NULL DEFAULT 1,
    voters JSONB NOT NULL DEFAULT '[]',
    target_engine VARCHAR(100),
    submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for Feedback
ALTER TABLE customer_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_feedback ON customer_feedback;
CREATE POLICY tenant_isolation_feedback ON customer_feedback
    FOR ALL
    USING (true) -- Authenticated users can view feedback and community votes
    WITH CHECK (organization_id = get_current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_feedback_org ON customer_feedback(organization_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON customer_feedback(status);

-- 3. Release Notes & Knowledge Changelogs (Immutable Version History)
CREATE TABLE IF NOT EXISTS release_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version VARCHAR(50) NOT NULL,
    release_date DATE NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'PLATFORM', -- PLATFORM, KNOWLEDGE_SNAPSHOT, ENGINE_RULE_BUNDLE
    title VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    features JSONB NOT NULL DEFAULT '[]',
    engine_changes JSONB NOT NULL DEFAULT '[]',
    knowledge_updates JSONB NOT NULL DEFAULT '[]',
    breaking_changes JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_release_notes_version ON release_notes(version);
CREATE INDEX IF NOT EXISTS idx_release_notes_cat ON release_notes(category);
