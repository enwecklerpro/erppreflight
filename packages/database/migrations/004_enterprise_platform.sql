-- ==============================================================================
-- ERP Preflight — Enterprise Platform Services Migration
-- Migration: 004_enterprise_platform.sql
-- Features: ChangeSets, Traceability Nodes, API Keys, Webhooks, Agent Gate,
--           Landscapes, and Row-Level Security (RLS) policies.
-- ==============================================================================

-- 1. ChangeSets (Change Simulation & What-If Engine)
CREATE TABLE IF NOT EXISTS changesets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    target_environment VARCHAR(50) NOT NULL DEFAULT 'QA',
    target_release VARCHAR(50) NOT NULL DEFAULT 'S4H_2023',
    baseline_analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL,
    proposed_changes JSONB NOT NULL DEFAULT '[]',
    simulation_result JSONB NOT NULL DEFAULT '{}',
    approval_status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    proposal_hash VARCHAR(64),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for ChangeSets
ALTER TABLE changesets ENABLE ROW LEVEL SECURITY;
ALTER TABLE changesets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_changesets ON changesets;
CREATE POLICY tenant_isolation_changesets ON changesets
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_changesets_org ON changesets(organization_id);
CREATE INDEX IF NOT EXISTS idx_changesets_proj ON changesets(project_id);

-- 2. Traceability Nodes (End-to-End Delivery Traceability Graph)
CREATE TABLE IF NOT EXISTS traceability_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    process_hierarchy VARCHAR(255) NOT NULL DEFAULT 'Core Logistics',
    requirement_id VARCHAR(100) NOT NULL,
    requirement_title VARCHAR(500) NOT NULL,
    finding_id UUID REFERENCES findings(id) ON DELETE SET NULL,
    remediation_task_id VARCHAR(100),
    task_status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    test_case_id UUID REFERENCES tests(id) ON DELETE SET NULL,
    test_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    defect_id VARCHAR(100),
    transport_id VARCHAR(100),
    release_id VARCHAR(100) NOT NULL DEFAULT 'REL_2026_01',
    business_criticality VARCHAR(50) NOT NULL DEFAULT 'HIGH',
    external_system VARCHAR(50) NOT NULL DEFAULT 'SAP_CLOUD_ALM',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for Traceability Nodes
ALTER TABLE traceability_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE traceability_nodes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_traceability ON traceability_nodes;
CREATE POLICY tenant_isolation_traceability ON traceability_nodes
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_traceability_org ON traceability_nodes(organization_id);
CREATE INDEX IF NOT EXISTS idx_traceability_proj ON traceability_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_traceability_req ON traceability_nodes(requirement_id);

-- 3. API Keys (Developer API & CI/CD Integration)
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    prefix VARCHAR(16) NOT NULL,
    key_hash VARCHAR(64) NOT NULL,
    scopes JSONB NOT NULL DEFAULT '["projects:read", "analysis:run", "analysis:read", "reports:read"]',
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for API Keys
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_api_keys ON api_keys;
CREATE POLICY tenant_isolation_api_keys ON api_keys
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- 4. Webhooks (Real-Time Enterprise Notifications)
CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    url VARCHAR(1000) NOT NULL,
    secret VARCHAR(255) NOT NULL,
    events JSONB NOT NULL DEFAULT '["analysis.completed", "analysis.failed", "finding.critical"]',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_triggered_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for Webhooks
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_webhooks ON webhooks;
CREATE POLICY tenant_isolation_webhooks ON webhooks
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_webhooks_org ON webhooks(organization_id);

-- 5. Registered Agents (Agentic Change Gate & MCP Identity)
CREATE TABLE IF NOT EXISTS registered_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    runtime VARCHAR(100) NOT NULL DEFAULT 'MCP_CLIENT',
    allowed_tools JSONB NOT NULL DEFAULT '["search_knowledge", "run_preflight", "get_findings"]',
    scopes JSONB NOT NULL DEFAULT '["preflight:run", "changes:propose"]',
    max_risk_class VARCHAR(50) NOT NULL DEFAULT 'MEDIUM',
    approval_mode VARCHAR(50) NOT NULL DEFAULT 'APPROVAL_REQUIRED',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for Registered Agents
ALTER TABLE registered_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE registered_agents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_reg_agents ON registered_agents;
CREATE POLICY tenant_isolation_reg_agents ON registered_agents
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_reg_agents_org ON registered_agents(organization_id);

-- 6. Agent Proposals (Change Gate Preflight & Execution Tokens)
CREATE TABLE IF NOT EXISTS agent_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES registered_agents(id) ON DELETE CASCADE,
    change_type VARCHAR(100) NOT NULL,
    proposed_diff JSONB NOT NULL DEFAULT '{}',
    proposal_hash VARCHAR(64) NOT NULL,
    target_environment VARCHAR(50) NOT NULL DEFAULT 'QA',
    verdict VARCHAR(50) NOT NULL DEFAULT 'INSUFFICIENT_EVIDENCE',
    verdict_details JSONB NOT NULL DEFAULT '{}',
    approval_status VARCHAR(50) NOT NULL DEFAULT 'PENDING_REVIEW',
    execution_token VARCHAR(255),
    token_expires_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for Agent Proposals
ALTER TABLE agent_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_agent_props ON agent_proposals;
CREATE POLICY tenant_isolation_agent_props ON agent_proposals
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_agent_props_org ON agent_proposals(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_props_proj ON agent_proposals(project_id);

-- 7. Landscapes (Enterprise System Landscape Model)
CREATE TABLE IF NOT EXISTS landscapes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    system_id VARCHAR(50) NOT NULL,
    product VARCHAR(100) NOT NULL DEFAULT 'SAP S/4HANA',
    edition VARCHAR(100) NOT NULL DEFAULT 'Private Cloud',
    release VARCHAR(50) NOT NULL DEFAULT '2023',
    environment VARCHAR(50) NOT NULL DEFAULT 'DEV',
    url VARCHAR(500),
    business_role VARCHAR(100) DEFAULT 'Core ERP Production',
    criticality VARCHAR(50) NOT NULL DEFAULT 'HIGH',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for Landscapes
ALTER TABLE landscapes ENABLE ROW LEVEL SECURITY;
ALTER TABLE landscapes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_landscapes ON landscapes;
CREATE POLICY tenant_isolation_landscapes ON landscapes
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_landscapes_org ON landscapes(organization_id);
