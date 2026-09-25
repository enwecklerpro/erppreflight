-- ==============================================================================
-- ERP Preflight — SAP Object Catalog & Clean Core Inventory Migration
-- Migration: 007_sap_objects.sql
-- Features: SAP Technical Objects, Clean Core Tiering, Inbound/Outbound
--           Dependency Trees, and Row-Level Security (RLS) policies.
-- ==============================================================================

-- 1. SAP Objects Table
CREATE TABLE IF NOT EXISTS sap_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    object_type VARCHAR(50) NOT NULL, -- PROG, CLAS, INTF, FUGR, TABL, CDS, VIEW, DTEL, DOMA, TRAN, AUTH, DEVC, FORM, BADI, ENHO, WSDL
    description TEXT NOT NULL DEFAULT '',
    package VARCHAR(100) NOT NULL DEFAULT '$TMP',
    software_component VARCHAR(100) NOT NULL DEFAULT 'ZCUSTOM',
    clean_core_tier VARCHAR(50) NOT NULL DEFAULT 'TIER_1_CLOUD', -- TIER_1_CLOUD, TIER_2_DEVELOPER, TIER_3_CLASSIC
    modification_status VARCHAR(50) NOT NULL DEFAULT 'CUSTOM_Z', -- CUSTOM_Z, CUSTOM_PARTNER, SAP_STANDARD, SAP_MODIFIED, SAP_ENHANCED
    complexity JSONB NOT NULL DEFAULT '{"score": 15, "level": "LOW", "linesOfCode": 120, "statementsCount": 35, "cyclomaticComplexity": 3}',
    finding_summary JSONB NOT NULL DEFAULT '{"totalCount": 0, "blockerCount": 0, "criticalCount": 0, "majorCount": 0, "minorCount": 0, "infoCount": 0, "findings": []}',
    dependencies JSONB NOT NULL DEFAULT '[]',
    last_changed_by VARCHAR(100) NOT NULL DEFAULT 'DEVELOPER',
    last_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    transport_request VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Row Level Security for SAP Objects
ALTER TABLE sap_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE sap_objects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_sap_objects ON sap_objects;
CREATE POLICY tenant_isolation_sap_objects ON sap_objects
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

-- 3. High-Performance Query Indexes
CREATE INDEX IF NOT EXISTS idx_sap_objects_org_proj ON sap_objects(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_sap_objects_proj_tier ON sap_objects(project_id, clean_core_tier);
CREATE INDEX IF NOT EXISTS idx_sap_objects_proj_type ON sap_objects(project_id, object_type);
CREATE INDEX IF NOT EXISTS idx_sap_objects_name ON sap_objects(name);
CREATE INDEX IF NOT EXISTS idx_sap_objects_pkg ON sap_objects(package);
