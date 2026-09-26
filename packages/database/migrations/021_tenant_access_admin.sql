-- ==============================================================================
-- ERP Preflight — Tenant access administration
-- Migration: 021_tenant_access_admin.sql
-- Specifications: Part 10 §10.2 (IP allowlists), §10.7 (suspend/reactivate,
--   extend trial), §10.8 + section C §24 (safe impersonation: permission, reason,
--   banner, audit, expiry), §10.14 / C §62 (support tickets), §10.15 (audit).
--
-- 1. organizations: suspension state (who, when, why) and trial-extension
--    bookkeeping (original trial end + cumulative extension, bounded to 90 days).
-- 2. impersonation_sessions: time-boxed (<= 30 min), reason-bound super-admin
--    impersonation of one tenant member. Read-only unless the tenant granted
--    support access. Ending or expiry revokes the token (the API checks this row
--    on every request).
-- 3. platform_audit_events: append-only platform ledger of super-admin actions
--    (suspension, trial extension, impersonation start/end and every request made
--    while impersonating). Complements the per-tenant hash-chained audit_events.
-- 4. organization_ip_allowlist: per-organization CIDR allowlist (IPv4/IPv6).
-- 5. support_ticket_messages: ticket conversation (customer and support replies);
--    support_tickets.locale selects the language of requester e-mails.
--
-- Every new table carrying organization_id: ENABLE + FORCE RLS, tenant policy on
-- NULLIF(current_setting('app.current_tenant_id', true), '')::uuid and grants for
-- the runtime role erppreflight_app (pattern of migrations 010 / 012 / 017).
-- Platform (super-admin) reads run outside tenant transactions (bypassRls), like
-- support_access_grants in migration 012.
-- ==============================================================================

-- 1. Organization suspension + trial extension ----------------------------------
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_original_ends_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_extended_days INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_org_suspension_consistency') THEN
        ALTER TABLE organizations ADD CONSTRAINT chk_org_suspension_consistency
            CHECK (status <> 'SUSPENDED' OR (suspended_at IS NOT NULL AND suspension_reason IS NOT NULL));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_org_trial_extended_days') THEN
        ALTER TABLE organizations ADD CONSTRAINT chk_org_trial_extended_days
            CHECK (trial_extended_days BETWEEN 0 AND 90);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_organizations_suspended ON organizations(status) WHERE status = 'SUSPENDED';

-- 2. Impersonation sessions ------------------------------------------------------
CREATE TABLE IF NOT EXISTS impersonation_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    impersonator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    impersonator_email VARCHAR(255) NOT NULL,
    -- The impersonator's own organization (the web app returns there on end); no FK.
    impersonator_organization_id UUID,
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    target_email VARCHAR(255) NOT NULL,
    reason TEXT NOT NULL,
    read_only BOOLEAN NOT NULL DEFAULT TRUE,
    -- Tenant-issued support_access_grants row that authorised a read-write session (no FK:
    -- the reference stays as history after the grant row is gone).
    support_grant_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    end_reason VARCHAR(30),
    ended_by UUID,
    request_count INTEGER NOT NULL DEFAULT 0,
    last_request_at TIMESTAMPTZ,
    client_ip INET,
    user_agent VARCHAR(500),
    CONSTRAINT chk_impersonation_reason CHECK (char_length(btrim(reason)) BETWEEN 10 AND 1000),
    CONSTRAINT chk_impersonation_window CHECK (
        expires_at > created_at AND expires_at <= created_at + INTERVAL '30 minutes'),
    CONSTRAINT chk_impersonation_end CHECK (
        (ended_at IS NULL AND end_reason IS NULL)
        OR (ended_at IS NOT NULL AND end_reason IN (
            'ENDED_BY_IMPERSONATOR', 'ENDED_BY_ADMIN', 'EXPIRED', 'SUPERSEDED', 'LOGOUT', 'TARGET_INVALID')))
);

CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_org ON impersonation_sessions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_active
    ON impersonation_sessions(impersonator_id, expires_at) WHERE ended_at IS NULL;

ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE impersonation_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_impersonation_sessions ON impersonation_sessions;
CREATE POLICY tenant_isolation_impersonation_sessions ON impersonation_sessions
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON impersonation_sessions TO erppreflight_app;
REVOKE DELETE ON impersonation_sessions FROM erppreflight_app;

-- 3. Platform audit ledger (append-only) -----------------------------------------
CREATE TABLE IF NOT EXISTS platform_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_num BIGSERIAL,
    -- Tenant the action concerns (NULL for platform-wide actions).
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    actor_id UUID,
    actor_email VARCHAR(255),
    impersonation_id UUID,
    action VARCHAR(120) NOT NULL,
    target_type VARCHAR(60) NOT NULL,
    target_id UUID,
    payload JSONB NOT NULL DEFAULT '{}',
    client_ip INET,
    user_agent VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_platform_audit_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_org ON platform_audit_events(organization_id, sequence_num DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_impersonation
    ON platform_audit_events(impersonation_id, sequence_num) WHERE impersonation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON platform_audit_events(created_at DESC);

-- Same rule as audit_events (migration 011): no UPDATE ever; DELETE only as the cascade
-- of a declared GDPR erasure of exactly this organization.
CREATE OR REPLACE FUNCTION platform_audit_events_immutable_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND OLD.organization_id IS NOT NULL
       AND NULLIF(current_setting('app.erasure_organization_id', true), '') IS NOT NULL
       AND OLD.organization_id::text = current_setting('app.erasure_organization_id', true) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Audit trail violation: platform_audit_events is append-only.'
    USING ERRCODE = '55P02';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_platform_audit_events_immutable ON platform_audit_events;
CREATE TRIGGER trg_platform_audit_events_immutable
BEFORE UPDATE OR DELETE ON platform_audit_events
FOR EACH ROW
EXECUTE FUNCTION platform_audit_events_immutable_guard();

ALTER TABLE platform_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_platform_audit_events ON platform_audit_events;
CREATE POLICY tenant_isolation_platform_audit_events ON platform_audit_events
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT ON platform_audit_events TO erppreflight_app;
REVOKE UPDATE, DELETE ON platform_audit_events FROM erppreflight_app;
GRANT USAGE, SELECT ON SEQUENCE platform_audit_events_sequence_num_seq TO erppreflight_app;

-- 4. Organization IP allowlist ---------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_ip_allowlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    cidr CIDR NOT NULL,
    label VARCHAR(100),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_organization_ip_allowlist UNIQUE (organization_id, cidr)
);

CREATE INDEX IF NOT EXISTS idx_organization_ip_allowlist_org ON organization_ip_allowlist(organization_id);

ALTER TABLE organization_ip_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_ip_allowlist FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_organization_ip_allowlist ON organization_ip_allowlist;
CREATE POLICY tenant_isolation_organization_ip_allowlist ON organization_ip_allowlist
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_ip_allowlist TO erppreflight_app;

-- 5. Support ticket conversation + requester locale ------------------------------
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS locale VARCHAR(5) NOT NULL DEFAULT 'en';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_support_ticket_locale') THEN
        ALTER TABLE support_tickets ADD CONSTRAINT chk_support_ticket_locale CHECK (locale IN ('en', 'de'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    author_role VARCHAR(20) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_support_message_role CHECK (author_role IN ('CUSTOMER', 'SUPPORT')),
    CONSTRAINT chk_support_message_body CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000)
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket ON support_ticket_messages(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_org ON support_ticket_messages(organization_id);

ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_support_ticket_messages ON support_ticket_messages;
CREATE POLICY tenant_isolation_support_ticket_messages ON support_ticket_messages
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT ON support_ticket_messages TO erppreflight_app;
REVOKE UPDATE, DELETE ON support_ticket_messages FROM erppreflight_app;
