-- ==============================================================================
-- ERP Preflight — Transactional Domain Events Outbox Architecture
-- Migration: 008_domain_events_outbox.sql
-- Specifications: Part 16.7 (Transactional Outbox / Event Architecture)
-- Features: At-least-once delivery, guaranteed consistency with database state,
--           idempotent event processing, and Row-Level Security (RLS).
-- ==============================================================================

-- 1. Domain Events Outbox Table
CREATE TABLE IF NOT EXISTS domain_events_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL, -- finding.created, finding.reviewed, analysis.completed, change_set.approved, agent.proposal_verdict
    aggregate_type VARCHAR(50) NOT NULL, -- ANALYSIS, FINDING, PROJECT, CHANGE_SET, AGENT_PROPOSAL
    aggregate_id UUID NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, DISPATCHED, FAILED
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    last_attempt_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ
);

-- 2. Row Level Security for Outbox Table
ALTER TABLE domain_events_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_events_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_domain_events_outbox ON domain_events_outbox;
CREATE POLICY tenant_isolation_domain_events_outbox ON domain_events_outbox
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

-- 3. High-Performance Query & Dispatch Indexes
CREATE INDEX IF NOT EXISTS idx_outbox_pending_dispatch ON domain_events_outbox(status, created_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_outbox_org_agg ON domain_events_outbox(organization_id, aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_outbox_event_type ON domain_events_outbox(event_type);
