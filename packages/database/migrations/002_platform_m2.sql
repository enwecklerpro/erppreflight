-- ==============================================================================
-- ERP Preflight — Platform Services M2 Database Migration
-- Migration: 002_platform_m2.sql
-- Features: Reports table with RLS, Audit Immutability Trigger, Evidence offsets
-- ==============================================================================

-- 1. Reports Table (Generated Preflight Exports)
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    format VARCHAR(50) NOT NULL,
    file_name VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    s3_key VARCHAR(1000) NOT NULL,
    checksum_sha256 VARCHAR(64) NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for Reports Table
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_reports ON reports;
CREATE POLICY tenant_isolation_reports ON reports
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_reports_org ON reports(organization_id);
CREATE INDEX IF NOT EXISTS idx_reports_proj ON reports(project_id);
CREATE INDEX IF NOT EXISTS idx_reports_analysis ON reports(analysis_id);

-- 2. Audit Trail Immutability Guard Function & Trigger
CREATE OR REPLACE FUNCTION audit_events_immutable_guard()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit trail violation: audit_events table is strictly append-only. UPDATE and DELETE operations are prohibited by law and platform invariant.'
    USING ERRCODE = '55P02';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_immutable_guard ON audit_events;
CREATE TRIGGER trg_audit_events_immutable_guard
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION audit_events_immutable_guard();

-- 3. Enhance audit_events with actor_type, client_ip, user_agent if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_events' AND column_name = 'actor_type') THEN
        ALTER TABLE audit_events ADD COLUMN actor_type VARCHAR(50) NOT NULL DEFAULT 'SYSTEM';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_events' AND column_name = 'client_ip') THEN
        ALTER TABLE audit_events ADD COLUMN client_ip INET;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_events' AND column_name = 'user_agent') THEN
        ALTER TABLE audit_events ADD COLUMN user_agent TEXT;
    END IF;
END $$;
