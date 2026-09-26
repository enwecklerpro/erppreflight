-- ==============================================================================
-- ERP Preflight — Commercial & Governance Completeness
-- Migration: 012_billing_usage_retention.sql
-- Specifications: Part 10.3 (plans), 10.4 (billing), 10.5 (usage metering),
--                 10.15 (audit logs), 10.16 (file retention), 13.8 (trials)
--
--   1. Subscription, trial, limit-override and retention state on organizations.
--   2. usage_events: append-only per-tenant usage ledger (RLS, tenant-scoped).
--   3. billing_events: Stripe webhook idempotency ledger (platform-only table;
--      the runtime role has no access at all).
--   4. Audit/usage ledgers are made append-only for the runtime role at the
--      privilege level (in addition to the trigger from migration 002).
-- ==============================================================================

-- 1. Organization subscription / trial / retention state -----------------------
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(30) NOT NULL DEFAULT 'NONE';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_tier VARCHAR(50);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_expired_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS limit_overrides JSONB NOT NULL DEFAULT '{}';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS artifact_retention_days INTEGER;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS report_retention_days INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_org_subscription_status') THEN
        ALTER TABLE organizations ADD CONSTRAINT chk_org_subscription_status
            CHECK (subscription_status IN ('NONE','TRIALING','ACTIVE','PAST_DUE','UNPAID','CANCELED','INCOMPLETE'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_org_artifact_retention') THEN
        ALTER TABLE organizations ADD CONSTRAINT chk_org_artifact_retention
            CHECK (artifact_retention_days IS NULL OR artifact_retention_days BETWEEN 0 AND 3650);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_org_report_retention') THEN
        ALTER TABLE organizations ADD CONSTRAINT chk_org_report_retention
            CHECK (report_retention_days IS NULL OR report_retention_days BETWEEN 1 AND 3650);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_org_limit_overrides_object') THEN
        ALTER TABLE organizations ADD CONSTRAINT chk_org_limit_overrides_object
            CHECK (jsonb_typeof(limit_overrides) = 'object');
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_stripe_customer
    ON organizations(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_trial_ends ON organizations(trial_ends_at) WHERE trial_expired_at IS NULL;

-- 2. Usage metering ledger (append-only, tenant-scoped) -------------------------
CREATE TABLE IF NOT EXISTS usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    metric VARCHAR(40) NOT NULL,
    quantity BIGINT NOT NULL CHECK (quantity >= 0),
    resource_type VARCHAR(60),
    resource_id UUID,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_usage_metric CHECK (metric IN (
        'ANALYSIS_RUN','ENGINE_EXECUTION','ARTIFACT_UPLOAD','ARTIFACT_BYTES','REPORT_EXPORT','AI_TOKENS'
    ))
);

CREATE INDEX IF NOT EXISTS idx_usage_events_org_metric_time
    ON usage_events(organization_id, metric, occurred_at DESC);

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_usage_events ON usage_events;
CREATE POLICY tenant_isolation_usage_events ON usage_events
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 3. Stripe webhook idempotency ledger (platform scope) -------------------------
CREATE TABLE IF NOT EXISTS billing_events (
    provider_event_id VARCHAR(255) PRIMARY KEY,
    provider VARCHAR(30) NOT NULL DEFAULT 'stripe',
    event_type VARCHAR(100) NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    payload_sha256 VARCHAR(64) NOT NULL,
    outcome VARCHAR(40) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_events_org ON billing_events(organization_id, received_at DESC);

-- 4. Runtime-role privileges ----------------------------------------------------
GRANT SELECT, INSERT ON usage_events TO erppreflight_app;
REVOKE UPDATE, DELETE, TRUNCATE ON usage_events FROM erppreflight_app;
-- Audit trail: append-only for the application role (trigger from 002 also blocks UPDATE/DELETE).
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM erppreflight_app;
-- billing_events is only touched through the platform (owner) connection.
REVOKE ALL ON billing_events FROM erppreflight_app;

-- 5. Per-tenant contiguous audit chain position ----------------------------------
--    sequence_num (migration 003) is a GLOBAL BIGSERIAL, so a tenant's ledger
--    legitimately has gaps wherever other tenants wrote events; gap detection
--    therefore needs a per-tenant counter. chain_seq is assigned under the
--    per-tenant advisory lock at insert time. It is not part of the hash input,
--    so the one-time backfill below cannot alter any chain hash.
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS chain_seq BIGINT;

ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable_guard;
UPDATE audit_events e
   SET chain_seq = ranked.rn
  FROM (
    SELECT id, row_number() OVER (PARTITION BY organization_id ORDER BY sequence_num ASC, created_at ASC, id ASC) AS rn
      FROM audit_events
  ) ranked
 WHERE ranked.id = e.id AND e.chain_seq IS NULL;
ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable_guard;

CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_events_org_chain_seq ON audit_events(organization_id, chain_seq);
