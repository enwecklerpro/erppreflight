-- ==============================================================================
-- ERP Preflight — Enterprise Integrations, Identity & Partner Mode
-- Migration: 015_connectors_identity_partner.sql
-- Specifications: Part 03 §3.11/§3.12, Part 11, Part 15 (§15.2–15.8, §15.23–15.24),
--                 Part 18 (§18.1–18.8), Section C §33–§36, §47–§48, §8.4, §61.
--
-- Every table is tenant-scoped (organization_id) with ENABLE + FORCE Row-Level
-- Security and the standard policy
--   organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
-- (via get_current_tenant_id() from migration 001). Grants to the runtime role
-- erppreflight_app follow migration 010.
--
-- Secrets (connector credentials, IdP client secrets) are stored ONLY as
-- AES-256-GCM ciphertext produced by the API credential vault (key id recorded
-- for rotation). Bearer tokens (SCIM, agent device, enrollment) are stored as
-- SHA-256 hashes only.
-- ==============================================================================

-- ---------------------------------------------------------------------------
-- 1. Connector instances (per-tenant configured connections)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connector_type VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    credentials_ciphertext TEXT,
    credentials_key_id VARCHAR(64),
    credentials_updated_at TIMESTAMPTZ,
    access_mode VARCHAR(20) NOT NULL DEFAULT 'READ_ONLY',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    health_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
    last_checked_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    last_error VARCHAR(1000),
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    circuit_state VARCHAR(20) NOT NULL DEFAULT 'CLOSED',
    circuit_opened_at TIMESTAMPTZ,
    capabilities JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT connector_instances_type_chk CHECK (connector_type IN (
        'HTTP_OPENAPI', 'ODATA', 'SAP_CLOUD_ALM', 'JIRA', 'AZURE_DEVOPS', 'SERVICENOW', 'GIT', 'FILE', 'LOCAL_AGENT'
    )),
    CONSTRAINT connector_instances_mode_chk CHECK (access_mode IN ('READ_ONLY', 'READ_WRITE')),
    CONSTRAINT connector_instances_status_chk CHECK (status IN ('ACTIVE', 'DISABLED')),
    CONSTRAINT connector_instances_health_chk CHECK (health_status IN ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY')),
    CONSTRAINT connector_instances_circuit_chk CHECK (circuit_state IN ('CLOSED', 'OPEN', 'HALF_OPEN')),
    UNIQUE (organization_id, name)
);
CREATE INDEX IF NOT EXISTS idx_connector_instances_org ON connector_instances(organization_id);
CREATE INDEX IF NOT EXISTS idx_connector_instances_type ON connector_instances(organization_id, connector_type);

-- ---------------------------------------------------------------------------
-- 2. Connector sync / call log (Part 15.24 integration health & audit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connector_id UUID NOT NULL REFERENCES connector_instances(id) ON DELETE CASCADE,
    operation VARCHAR(80) NOT NULL,
    object_type VARCHAR(80),
    object_ref VARCHAR(255),
    outcome VARCHAR(20) NOT NULL,
    http_status INTEGER,
    error VARCHAR(1000),
    duration_ms INTEGER,
    attempt INTEGER NOT NULL DEFAULT 1,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT connector_sync_log_outcome_chk CHECK (outcome IN ('SUCCESS', 'FAILED', 'SKIPPED', 'CONFLICT', 'BLOCKED'))
);
CREATE INDEX IF NOT EXISTS idx_connector_sync_log_conn ON connector_sync_log(connector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_sync_log_org ON connector_sync_log(organization_id);

-- ---------------------------------------------------------------------------
-- 3. Project <-> external project mapping (Cloud ALM project mapping, Jira project, ADO project)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_project_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connector_id UUID NOT NULL REFERENCES connector_instances(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    external_project_id VARCHAR(255) NOT NULL,
    sync_direction VARCHAR(20) NOT NULL DEFAULT 'PUSH_ONLY',
    system_of_record VARCHAR(20) NOT NULL DEFAULT 'EXTERNAL',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT connector_project_links_dir_chk CHECK (sync_direction IN ('PULL_ONLY', 'PUSH_ONLY', 'BIDIRECTIONAL')),
    CONSTRAINT connector_project_links_sor_chk CHECK (system_of_record IN ('EXTERNAL', 'ERP_PREFLIGHT')),
    UNIQUE (connector_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_connector_project_links_org ON connector_project_links(organization_id);

-- ---------------------------------------------------------------------------
-- 4. External work items (Part 15.3 sync safety: every synchronized object)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_work_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    finding_id UUID REFERENCES findings(id) ON DELETE SET NULL,
    connector_id UUID NOT NULL REFERENCES connector_instances(id) ON DELETE CASCADE,
    external_system VARCHAR(50) NOT NULL,
    external_tenant VARCHAR(255),
    external_project_id VARCHAR(255),
    external_id VARCHAR(255) NOT NULL,
    external_key VARCHAR(255),
    external_url VARCHAR(2000),
    external_status VARCHAR(100),
    status_category VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    remediation_state VARCHAR(40) NOT NULL DEFAULT 'OPEN',
    sync_direction VARCHAR(20) NOT NULL DEFAULT 'PUSH_ONLY',
    sync_version VARCHAR(255),
    payload_sha256 VARCHAR(64),
    last_synced_at TIMESTAMPTZ,
    last_local_modified_at TIMESTAMPTZ,
    last_remote_modified_at TIMESTAMPTZ,
    conflict_state VARCHAR(20) NOT NULL DEFAULT 'NONE',
    conflict_details JSONB,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT external_work_items_cat_chk CHECK (status_category IN ('OPEN', 'IN_PROGRESS', 'DONE', 'UNKNOWN')),
    CONSTRAINT external_work_items_rem_chk CHECK (remediation_state IN ('OPEN', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'VERIFIED_RESOLVED')),
    CONSTRAINT external_work_items_conflict_chk CHECK (conflict_state IN ('NONE', 'CONFLICT', 'RESOLVED')),
    UNIQUE (connector_id, external_id)
);
-- A finding is linked to at most one work item per connector (prevents duplicate creation).
CREATE UNIQUE INDEX IF NOT EXISTS uq_external_work_items_finding_conn
    ON external_work_items(connector_id, finding_id) WHERE finding_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_external_work_items_org ON external_work_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_external_work_items_project ON external_work_items(project_id);
CREATE INDEX IF NOT EXISTS idx_external_work_items_finding ON external_work_items(finding_id);

-- ---------------------------------------------------------------------------
-- 5. Normalized service metadata snapshots (OData $metadata / OpenAPI) — API Change Guard baselines
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_metadata_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connector_id UUID NOT NULL REFERENCES connector_instances(id) ON DELETE CASCADE,
    kind VARCHAR(30) NOT NULL,
    service_path VARCHAR(1000) NOT NULL,
    protocol_version VARCHAR(20),
    content_sha256 VARCHAR(64) NOT NULL,
    content_bytes INTEGER NOT NULL,
    normalized JSONB NOT NULL,
    summary JSONB NOT NULL DEFAULT '{}',
    fetched_by UUID REFERENCES users(id) ON DELETE SET NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT connector_metadata_kind_chk CHECK (kind IN ('ODATA_METADATA', 'OPENAPI', 'GIT_TREE'))
);
CREATE INDEX IF NOT EXISTS idx_connector_metadata_conn ON connector_metadata_snapshots(connector_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_metadata_org ON connector_metadata_snapshots(organization_id);

-- ---------------------------------------------------------------------------
-- 6. Local agent: enrollment tokens, devices, signed jobs (Part 03 §3.12, Part 18.7/18.8, C §36)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_enrollment_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    label VARCHAR(200),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    device_id UUID,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_enroll_org ON agent_enrollment_tokens(organization_id);

CREATE TABLE IF NOT EXISTS agent_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connector_id UUID REFERENCES connector_instances(id) ON DELETE SET NULL,
    name VARCHAR(200) NOT NULL,
    hostname VARCHAR(255),
    public_key_pem TEXT NOT NULL,
    public_key_fingerprint VARCHAR(64) NOT NULL,
    credential_hash VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    agent_version VARCHAR(50),
    platform VARCHAR(100),
    capabilities JSONB NOT NULL DEFAULT '[]',
    update_channel VARCHAR(20) NOT NULL DEFAULT 'stable',
    egress_policy JSONB NOT NULL DEFAULT '{"redactSecrets": true, "uploadRawFiles": false}',
    last_seen_at TIMESTAMPTZ,
    last_heartbeat JSONB,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT agent_devices_status_chk CHECK (status IN ('ACTIVE', 'REVOKED'))
);
CREATE INDEX IF NOT EXISTS idx_agent_devices_org ON agent_devices(organization_id);

CREATE TABLE IF NOT EXISTS agent_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES agent_devices(id) ON DELETE CASCADE,
    job_type VARCHAR(40) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    signed_envelope TEXT NOT NULL,
    signature VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    result JSONB,
    error VARCHAR(1000),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT agent_jobs_type_chk CHECK (job_type IN ('SCAN_DIRECTORY', 'PROBE_URL')),
    CONSTRAINT agent_jobs_status_chk CHECK (status IN ('QUEUED', 'DISPATCHED', 'COMPLETED', 'FAILED', 'EXPIRED', 'REJECTED'))
);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_device ON agent_jobs(device_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_org ON agent_jobs(organization_id);

-- ---------------------------------------------------------------------------
-- 7. Webhook delivery log (C §48: signed deliveries, retry, replay, idempotency)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 6,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_http_status INTEGER,
    last_error VARCHAR(500),
    last_duration_ms INTEGER,
    replay_of UUID REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    CONSTRAINT webhook_deliveries_status_chk CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'DEAD')),
    UNIQUE (webhook_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_hook ON webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org ON webhook_deliveries(organization_id);

-- ---------------------------------------------------------------------------
-- 8. Enterprise identity: OIDC IdP config, verified domains, SCIM tokens / links / groups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sso_identity_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    protocol VARCHAR(10) NOT NULL DEFAULT 'OIDC',
    issuer VARCHAR(1000) NOT NULL,
    client_id VARCHAR(500) NOT NULL,
    client_secret_ciphertext TEXT,
    client_secret_key_id VARCHAR(64),
    scopes VARCHAR(500) NOT NULL DEFAULT 'openid email profile',
    jit_provisioning BOOLEAN NOT NULL DEFAULT TRUE,
    default_role VARCHAR(50) NOT NULL DEFAULT 'VIEWER',
    enforce_sso BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    discovery JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT sso_idp_protocol_chk CHECK (protocol IN ('OIDC')),
    CONSTRAINT sso_idp_status_chk CHECK (status IN ('ACTIVE', 'DISABLED'))
);

CREATE TABLE IF NOT EXISTS sso_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    domain VARCHAR(253) NOT NULL,
    verification_token VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    verified_at TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT sso_domains_status_chk CHECK (status IN ('PENDING', 'VERIFIED', 'FAILED')),
    UNIQUE (organization_id, domain)
);
-- A domain can be VERIFIED for at most one organization.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sso_domains_verified ON sso_domains(domain) WHERE status = 'VERIFIED';
CREATE INDEX IF NOT EXISTS idx_sso_domains_org ON sso_domains(organization_id);

CREATE TABLE IF NOT EXISTS scim_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    prefix VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    last_used_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT scim_tokens_status_chk CHECK (status IN ('ACTIVE', 'REVOKED'))
);
CREATE INDEX IF NOT EXISTS idx_scim_tokens_org ON scim_tokens(organization_id);

CREATE TABLE IF NOT EXISTS scim_user_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    external_id VARCHAR(255),
    user_name VARCHAR(255) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    source VARCHAR(20) NOT NULL DEFAULT 'SCIM',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT scim_user_links_source_chk CHECK (source IN ('SCIM', 'OIDC_JIT')),
    UNIQUE (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_scim_user_links_org ON scim_user_links(organization_id);

CREATE TABLE IF NOT EXISTS scim_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    display_name VARCHAR(255) NOT NULL,
    external_id VARCHAR(255),
    mapped_role VARCHAR(50),
    member_user_ids JSONB NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, display_name)
);
CREATE INDEX IF NOT EXISTS idx_scim_groups_org ON scim_groups(organization_id);

-- ---------------------------------------------------------------------------
-- 9. Partner mode: customer-granted, audited delegated access (C §61)
--    organization_id = the CUSTOMER organization (grantor). The partner
--    organization can read grants addressed to it (second policy predicate).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partner_access_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    partner_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    access_role VARCHAR(50) NOT NULL DEFAULT 'VIEWER',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    reason VARCHAR(1000),
    expires_at TIMESTAMPTZ NOT NULL,
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT partner_grants_role_chk CHECK (access_role IN ('VIEWER', 'ANALYST', 'PROJECT_ADMIN')),
    CONSTRAINT partner_grants_status_chk CHECK (status IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT partner_grants_not_self_chk CHECK (organization_id <> partner_organization_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_grants_active
    ON partner_access_grants(organization_id, partner_organization_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_partner_grants_partner ON partner_access_grants(partner_organization_id);

-- ---------------------------------------------------------------------------
-- 10. Row-Level Security
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'connector_instances', 'connector_sync_log', 'connector_project_links', 'external_work_items',
        'connector_metadata_snapshots', 'agent_enrollment_tokens', 'agent_devices', 'agent_jobs',
        'webhook_deliveries', 'sso_identity_providers', 'sso_domains', 'scim_tokens',
        'scim_user_links', 'scim_groups'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%s ON %I', t, t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%s ON %I FOR ALL '
            'USING (organization_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid) '
            'WITH CHECK (organization_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)',
            t, t
        );
    END LOOP;
END $$;

ALTER TABLE partner_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_access_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_partner_access_grants ON partner_access_grants;
-- Grantor (customer) has full control over its grants.
CREATE POLICY tenant_isolation_partner_access_grants ON partner_access_grants
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
DROP POLICY IF EXISTS partner_read_partner_access_grants ON partner_access_grants;
-- The partner organization may only READ grants addressed to it.
CREATE POLICY partner_read_partner_access_grants ON partner_access_grants
    FOR SELECT
    USING (partner_organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- 11. Runtime role grants (see migration 010)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erppreflight_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON
            connector_instances, connector_sync_log, connector_project_links, external_work_items,
            connector_metadata_snapshots, agent_enrollment_tokens, agent_devices, agent_jobs,
            webhook_deliveries, sso_identity_providers, sso_domains, scim_tokens,
            scim_user_links, scim_groups, partner_access_grants
        TO erppreflight_app;
    END IF;
END $$;
