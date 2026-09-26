-- ==============================================================================
-- ERP Preflight — Knowledge Graph, Release Intelligence & Notifications
-- Migration: 014_knowledge_graph_release_intelligence.sql
-- Specifications: Part 04 (§4.3 knowledge entities, §4.4 relationship graph,
--   §4.7 evidence model, §4.8 release-aware facts, §4.9 release watch),
--   Part 05 (§5.2 evidence, §5.3 release intelligence, §5.10 notifications),
--   Part 14 (§14.14 source ingestion, §14.33 notification center),
--   Part 17 (§17.3 immutable knowledge snapshots).
--
-- Scope model
--   * GLOBAL knowledge rows have organization_id IS NULL. They are readable by
--     every tenant and writable ONLY by maintenance paths (knowledge sync job,
--     CLI, super-admin curation) which run as the schema owner, never as the
--     RLS runtime role `erppreflight_app` (migration 010).
--   * TENANT knowledge rows (customer objects / edges, Part 04 §4.5) carry an
--     organization_id and are isolated by RLS like every other tenant table.
--   * Release watches, watch events and notifications are tenant tables.
--
-- Snapshot model (Part 17.3)
--   Every knowledge sync that changes content publishes one immutable
--   `knowledge_snapshots` row with a monotonically increasing `seq`.
--   Release states and relationships are versioned with validity ranges
--   [valid_from_seq, valid_to_seq): a fact is part of snapshot S when
--   valid_from_seq <= S AND (valid_to_seq IS NULL OR valid_to_seq > S).
--   Closing a range never rewrites the fact itself, so any historical
--   snapshot can be reconstructed exactly (analysis reproducibility).
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ------------------------------------------------------------------------------
-- 1. Product / edition / release catalog (global)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    vendor VARCHAR(100) NOT NULL DEFAULT 'SAP',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_editions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES knowledge_products(id) ON DELETE CASCADE,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    deployment VARCHAR(32) NOT NULL
        CHECK (deployment IN ('CLOUD_PUBLIC', 'CLOUD_PRIVATE', 'ON_PREMISE', 'BTP', 'HYBRID')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (product_id, code)
);

CREATE TABLE IF NOT EXISTS knowledge_releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edition_id UUID NOT NULL REFERENCES knowledge_editions(id) ON DELETE CASCADE,
    code VARCHAR(64) NOT NULL,
    label VARCHAR(200) NOT NULL,
    feature_pack VARCHAR(32),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_rolling BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (edition_id, code)
);

-- ------------------------------------------------------------------------------
-- 2. Evidence sources with trust levels (Part 04 §4.7)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_evidence_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    source_key VARCHAR(160) NOT NULL,
    trust_level VARCHAR(40) NOT NULL CHECK (trust_level IN (
        'OFFICIAL_REPOSITORY', 'OFFICIAL_DOCUMENTATION', 'OFFICIAL_SUPPORT',
        'OFFICIAL_COMMUNITY', 'CURATED_RULE', 'THIRD_PARTY', 'CUSTOMER_EVIDENCE', 'INFERRED')),
    title VARCHAR(300) NOT NULL,
    publisher VARCHAR(200),
    url TEXT,
    description TEXT,
    target_release_id UUID REFERENCES knowledge_releases(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'DISABLED')),
    superseded_by UUID REFERENCES knowledge_evidence_sources(id) ON DELETE SET NULL,
    reviewer VARCHAR(200),
    internal_note TEXT,
    publication_date TIMESTAMPTZ,
    last_retrieved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_evidence_source_global
    ON knowledge_evidence_sources(source_key) WHERE organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_evidence_source_tenant
    ON knowledge_evidence_sources(organization_id, source_key) WHERE organization_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 3. Immutable knowledge snapshots + sync run log (Part 17.3, Part 14.14)
-- ------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS knowledge_snapshot_seq START 1;

CREATE TABLE IF NOT EXISTS knowledge_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq BIGINT NOT NULL UNIQUE DEFAULT nextval('knowledge_snapshot_seq'),
    adapter_id VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'BUILDING' CHECK (status IN ('BUILDING', 'PUBLISHED')),
    content_sha256 CHAR(64) NOT NULL,
    parser_version VARCHAR(40) NOT NULL,
    source_versions JSONB NOT NULL DEFAULT '[]',
    stats JSONB NOT NULL DEFAULT '{}',
    diff_summary JSONB NOT NULL DEFAULT '{}',
    previous_snapshot_id UUID REFERENCES knowledge_snapshots(id),
    triggered_by VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_kg_snapshots_adapter ON knowledge_snapshots(adapter_id, seq DESC);

-- Published snapshots are immutable and can never be deleted.
CREATE OR REPLACE FUNCTION knowledge_snapshot_immutable() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'PUBLISHED' THEN
            RAISE EXCEPTION 'knowledge snapshot % is published and immutable', OLD.id;
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.status = 'PUBLISHED' THEN
        RAISE EXCEPTION 'knowledge snapshot % is published and immutable', OLD.id;
    END IF;
    IF NEW.seq <> OLD.seq OR NEW.content_sha256 <> OLD.content_sha256 OR NEW.adapter_id <> OLD.adapter_id THEN
        RAISE EXCEPTION 'knowledge snapshot identity columns are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_knowledge_snapshot_immutable ON knowledge_snapshots;
CREATE TRIGGER trg_knowledge_snapshot_immutable
    BEFORE UPDATE OR DELETE ON knowledge_snapshots
    FOR EACH ROW EXECUTE FUNCTION knowledge_snapshot_immutable();

CREATE TABLE IF NOT EXISTS knowledge_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adapter_id VARCHAR(64) NOT NULL,
    trigger VARCHAR(20) NOT NULL CHECK (trigger IN ('SCHEDULED', 'ADMIN', 'CLI', 'FILE_IMPORT')),
    triggered_by VARCHAR(200),
    status VARCHAR(20) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'NOOP', 'PUBLISHED', 'FAILED')),
    snapshot_id UUID REFERENCES knowledge_snapshots(id),
    content_sha256 CHAR(64),
    source_results JSONB NOT NULL DEFAULT '[]',
    stats JSONB NOT NULL DEFAULT '{}',
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_kg_sync_runs_started ON knowledge_sync_runs(started_at DESC);

-- ------------------------------------------------------------------------------
-- 4. Knowledge objects (base model; typed extension data in `attributes`)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    scope VARCHAR(10) NOT NULL DEFAULT 'GLOBAL' CHECK (scope IN ('GLOBAL', 'TENANT')),
    object_type VARCHAR(40) NOT NULL,
    sap_object_type VARCHAR(20) NOT NULL,
    object_key VARCHAR(200) NOT NULL,
    tadir_object VARCHAR(10),
    tadir_obj_name VARCHAR(200),
    display_name VARCHAR(300),
    description TEXT,
    application_component VARCHAR(60),
    software_component VARCHAR(60),
    attributes JSONB NOT NULL DEFAULT '{}',
    review_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (review_status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'DEPRECATED', 'SUPERSEDED')),
    reviewed_by VARCHAR(200),
    reviewed_at TIMESTAMPTZ,
    primary_source_id UUID REFERENCES knowledge_evidence_sources(id) ON DELETE SET NULL,
    first_seen_snapshot_id UUID REFERENCES knowledge_snapshots(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_kg_object_scope CHECK (
        (scope = 'GLOBAL' AND organization_id IS NULL) OR (scope = 'TENANT' AND organization_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_objects_global
    ON knowledge_objects(sap_object_type, object_key) WHERE organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_objects_tenant
    ON knowledge_objects(organization_id, sap_object_type, object_key) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kg_objects_key ON knowledge_objects(object_key text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_kg_objects_key_trgm ON knowledge_objects USING gin (object_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_kg_objects_type ON knowledge_objects(object_type);
CREATE INDEX IF NOT EXISTS idx_kg_objects_org ON knowledge_objects(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kg_objects_fts ON knowledge_objects USING gin (
    to_tsvector('simple', coalesce(object_key, '') || ' ' || coalesce(display_name, '') || ' ' || coalesce(description, '')));

CREATE TABLE IF NOT EXISTS knowledge_object_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES knowledge_objects(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    alias VARCHAR(200) NOT NULL,
    alias_type VARCHAR(30) NOT NULL
        CHECK (alias_type IN ('TADIR_CONTAINER', 'SYNONYM', 'LEGACY_NAME', 'TRANSACTION', 'DISPLAY_NAME', 'CUSTOMER_NAME')),
    source_id UUID REFERENCES knowledge_evidence_sources(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (object_id, alias, alias_type)
);
CREATE INDEX IF NOT EXISTS idx_kg_aliases_alias ON knowledge_object_aliases(alias text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_kg_aliases_trgm ON knowledge_object_aliases USING gin (alias gin_trgm_ops);

-- ------------------------------------------------------------------------------
-- 5. Release-aware support states (Part 04 §4.8 — never a bare boolean)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_object_release_states (
    id BIGSERIAL PRIMARY KEY,
    object_id UUID NOT NULL REFERENCES knowledge_objects(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    release_id UUID NOT NULL REFERENCES knowledge_releases(id) ON DELETE CASCADE,
    scheme VARCHAR(40) NOT NULL CHECK (scheme IN ('RELEASE_CONTRACT', 'CLASSIC_API_CLASSIFICATION', 'CURATED')),
    state VARCHAR(40) NOT NULL,
    support_state VARCHAR(40) NOT NULL CHECK (support_state IN (
        'RELEASED', 'DEPRECATED', 'NOT_RELEASED', 'NOT_TO_BE_RELEASED_STABLE',
        'CLASSIC_API', 'NO_API', 'SUPPORTED', 'BLOCKED', 'UNKNOWN')),
    clean_core_level CHAR(1) CHECK (clean_core_level IN ('A', 'B', 'C', 'D')),
    successor_classification VARCHAR(40),
    successor_concept VARCHAR(300),
    successors JSONB NOT NULL DEFAULT '[]',
    labels JSONB NOT NULL DEFAULT '[]',
    software_component VARCHAR(60),
    application_component VARCHAR(60),
    source_id UUID NOT NULL REFERENCES knowledge_evidence_sources(id),
    confidence_class VARCHAR(20) NOT NULL DEFAULT 'VERIFIED'
        CHECK (confidence_class IN ('VERIFIED', 'RULE_DERIVED', 'INFERRED', 'UNKNOWN')),
    confidence_score NUMERIC(4,3) NOT NULL DEFAULT 1.000,
    content_hash CHAR(64) NOT NULL,
    valid_from_seq BIGINT NOT NULL,
    valid_to_seq BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (valid_to_seq IS NULL OR valid_to_seq > valid_from_seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_states_current
    ON knowledge_object_release_states(object_id, release_id, scheme, source_id) WHERE valid_to_seq IS NULL;
-- One current fact per (object, release, scheme, evidence source): several sources may
-- assert the same fact (Part 04 §4.7 multiple evidence records; §14.15 conflict detection).
CREATE INDEX IF NOT EXISTS idx_kg_states_object ON knowledge_object_release_states(object_id);
CREATE INDEX IF NOT EXISTS idx_kg_states_release_current
    ON knowledge_object_release_states(release_id, scheme, support_state) WHERE valid_to_seq IS NULL;
CREATE INDEX IF NOT EXISTS idx_kg_states_from ON knowledge_object_release_states(valid_from_seq);
CREATE INDEX IF NOT EXISTS idx_kg_states_to ON knowledge_object_release_states(valid_to_seq) WHERE valid_to_seq IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 6. Relationship graph (Part 04 §4.4)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    scope VARCHAR(10) NOT NULL DEFAULT 'GLOBAL' CHECK (scope IN ('GLOBAL', 'TENANT')),
    source_object_id UUID NOT NULL REFERENCES knowledge_objects(id) ON DELETE CASCADE,
    target_object_id UUID NOT NULL REFERENCES knowledge_objects(id) ON DELETE CASCADE,
    relationship_type VARCHAR(40) NOT NULL CHECK (relationship_type IN (
        'DEPENDS_ON', 'USED_BY', 'EXPOSED_BY', 'SUCCESSOR_OF', 'REPLACES', 'RELATED_TO', 'MAPPED_TO',
        'EXTENDS', 'PROPAGATES_TO', 'CONTROLLED_BY', 'TRANSPORTED_IN', 'REQUIRES', 'BLOCKED_BY',
        'AVAILABLE_IN_RELEASE', 'DEPRECATED_IN_RELEASE', 'SUPPORTED_BY', 'CONSUMES', 'PRODUCES')),
    release_id UUID REFERENCES knowledge_releases(id) ON DELETE CASCADE,
    valid_from_release_id UUID REFERENCES knowledge_releases(id) ON DELETE SET NULL,
    valid_to_release_id UUID REFERENCES knowledge_releases(id) ON DELETE SET NULL,
    confidence_class VARCHAR(20) NOT NULL DEFAULT 'VERIFIED'
        CHECK (confidence_class IN ('VERIFIED', 'RULE_DERIVED', 'INFERRED', 'UNKNOWN')),
    confidence_score NUMERIC(4,3) NOT NULL DEFAULT 1.000,
    evidence_source_id UUID REFERENCES knowledge_evidence_sources(id) ON DELETE SET NULL,
    review_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (review_status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'DEPRECATED', 'SUPERSEDED')),
    attributes JSONB NOT NULL DEFAULT '{}',
    valid_from_seq BIGINT NOT NULL DEFAULT 0,
    valid_to_seq BIGINT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_kg_rel_scope CHECK (
        (scope = 'GLOBAL' AND organization_id IS NULL) OR (scope = 'TENANT' AND organization_id IS NOT NULL)),
    CONSTRAINT chk_kg_rel_no_self CHECK (source_object_id <> target_object_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_rel_current
    ON knowledge_relationships(
        COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
        source_object_id, target_object_id, relationship_type,
        COALESCE(release_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(evidence_source_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE valid_to_seq IS NULL;
CREATE INDEX IF NOT EXISTS idx_kg_rel_source ON knowledge_relationships(source_object_id) WHERE valid_to_seq IS NULL;
CREATE INDEX IF NOT EXISTS idx_kg_rel_target ON knowledge_relationships(target_object_id) WHERE valid_to_seq IS NULL;
CREATE INDEX IF NOT EXISTS idx_kg_rel_from ON knowledge_relationships(valid_from_seq);

-- ------------------------------------------------------------------------------
-- 7. Change events produced by each snapshot diff (global)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_change_events (
    id BIGSERIAL PRIMARY KEY,
    snapshot_id UUID NOT NULL REFERENCES knowledge_snapshots(id),
    snapshot_seq BIGINT NOT NULL,
    change_type VARCHAR(40) NOT NULL CHECK (change_type IN (
        'STATE_ADDED', 'STATE_REMOVED', 'NEWLY_RELEASED', 'NEWLY_DEPRECATED', 'RELEASE_WITHDRAWN',
        'STATE_CHANGED', 'SUCCESSOR_CHANGED', 'ATTRIBUTES_CHANGED')),
    object_id UUID NOT NULL REFERENCES knowledge_objects(id) ON DELETE CASCADE,
    release_id UUID NOT NULL REFERENCES knowledge_releases(id) ON DELETE CASCADE,
    scheme VARCHAR(40) NOT NULL,
    previous JSONB,
    current JSONB,
    requires_review BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kg_change_events_snapshot ON knowledge_change_events(snapshot_id, change_type);
CREATE INDEX IF NOT EXISTS idx_kg_change_events_object ON knowledge_change_events(object_id);

-- ------------------------------------------------------------------------------
-- 8. Release watches (tenant) and their evaluation events (Part 04 §4.9)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS release_watches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    watch_type VARCHAR(30) NOT NULL
        CHECK (watch_type IN ('OBJECT', 'API', 'FINDING', 'GAP', 'SUCCESSOR_MAPPING', 'REQUIREMENT')),
    label VARCHAR(300) NOT NULL,
    notes TEXT,
    target_object_ids UUID[] NOT NULL DEFAULT '{}',
    finding_id UUID REFERENCES findings(id) ON DELETE CASCADE,
    release_id UUID REFERENCES knowledge_releases(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED')),
    last_state JSONB NOT NULL DEFAULT '{}',
    last_snapshot_id UUID REFERENCES knowledge_snapshots(id),
    last_evaluated_at TIMESTAMPTZ,
    last_change_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_release_watches_org ON release_watches(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_release_watches_targets ON release_watches USING gin (target_object_ids);

CREATE TABLE IF NOT EXISTS release_watch_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    watch_id UUID NOT NULL REFERENCES release_watches(id) ON DELETE CASCADE,
    snapshot_id UUID NOT NULL REFERENCES knowledge_snapshots(id),
    event_type VARCHAR(40) NOT NULL CHECK (event_type IN (
        'GAP_CLOSED', 'GAP_OPENED', 'NEW_DEPRECATION', 'SUCCESSOR_CHANGED', 'STATE_CHANGED', 'OBJECT_REMOVED')),
    object_id UUID REFERENCES knowledge_objects(id) ON DELETE SET NULL,
    release_id UUID REFERENCES knowledge_releases(id) ON DELETE SET NULL,
    previous JSONB,
    current JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (watch_id, snapshot_id, event_type, object_id, release_id)
);
CREATE INDEX IF NOT EXISTS idx_release_watch_events_watch ON release_watch_events(watch_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 9. Notifications (tenant + user scoped) and per-user channel preferences
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(80) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'INFO'
        CHECK (severity IN ('BLOCKER', 'CRITICAL', 'MAJOR', 'MEDIUM', 'MINOR', 'LOW', 'INFO')),
    title VARCHAR(300) NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link VARCHAR(500),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    engine VARCHAR(100),
    resource_type VARCHAR(50),
    resource_id UUID,
    group_key VARCHAR(200),
    dedupe_key VARCHAR(200) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_inbox ON notifications(organization_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(organization_id, user_id) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(80) NOT NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, user_id, event_type, channel)
);

-- ------------------------------------------------------------------------------
-- 10. Analyses record the exact knowledge snapshot they used (Part 17.3/17.11)
-- ------------------------------------------------------------------------------
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS knowledge_snapshot_id UUID REFERENCES knowledge_snapshots(id);

-- ------------------------------------------------------------------------------
-- 11. Row-Level Security
--   Global catalog tables: readable by everyone; writable only when the
--   session is NOT the RLS runtime role (i.e. maintenance paths running as
--   the schema owner). Tenant request transactions always `SET LOCAL ROLE
--   erppreflight_app`, so they can never write global knowledge.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['knowledge_products', 'knowledge_editions', 'knowledge_releases',
                             'knowledge_snapshots', 'knowledge_sync_runs', 'knowledge_change_events']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS kg_global_read ON %I', t);
        EXECUTE format('CREATE POLICY kg_global_read ON %I FOR SELECT USING (true)', t);
        EXECUTE format('DROP POLICY IF EXISTS kg_global_maintain ON %I', t);
        EXECUTE format($p$CREATE POLICY kg_global_maintain ON %I FOR ALL
                         USING (current_user <> 'erppreflight_app')
                         WITH CHECK (current_user <> 'erppreflight_app')$p$, t);
    END LOOP;

    -- Mixed-scope knowledge tables: global rows (organization_id IS NULL) + tenant rows.
    FOREACH t IN ARRAY ARRAY['knowledge_evidence_sources', 'knowledge_objects', 'knowledge_object_aliases',
                             'knowledge_object_release_states', 'knowledge_relationships']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS kg_scope_read ON %I', t);
        EXECUTE format($p$CREATE POLICY kg_scope_read ON %I FOR SELECT
                         USING (organization_id IS NULL OR organization_id = get_current_tenant_id())$p$, t);
        EXECUTE format('DROP POLICY IF EXISTS kg_tenant_insert ON %I', t);
        EXECUTE format($p$CREATE POLICY kg_tenant_insert ON %I FOR INSERT
                         WITH CHECK (organization_id IS NOT NULL AND organization_id = get_current_tenant_id())$p$, t);
        EXECUTE format('DROP POLICY IF EXISTS kg_tenant_update ON %I', t);
        EXECUTE format($p$CREATE POLICY kg_tenant_update ON %I FOR UPDATE
                         USING (organization_id IS NOT NULL AND organization_id = get_current_tenant_id())
                         WITH CHECK (organization_id IS NOT NULL AND organization_id = get_current_tenant_id())$p$, t);
        EXECUTE format('DROP POLICY IF EXISTS kg_tenant_delete ON %I', t);
        EXECUTE format($p$CREATE POLICY kg_tenant_delete ON %I FOR DELETE
                         USING (organization_id IS NOT NULL AND organization_id = get_current_tenant_id())$p$, t);
        EXECUTE format('DROP POLICY IF EXISTS kg_global_maintain ON %I', t);
        EXECUTE format($p$CREATE POLICY kg_global_maintain ON %I FOR ALL
                         USING (current_user <> 'erppreflight_app')
                         WITH CHECK (current_user <> 'erppreflight_app')$p$, t);
    END LOOP;

    -- Pure tenant tables.
    FOREACH t IN ARRAY ARRAY['release_watches', 'release_watch_events', 'notifications', 'notification_preferences']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%s ON %I', t, t);
        EXECUTE format($p$CREATE POLICY tenant_isolation_%s ON %I FOR ALL
                         USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
                         WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$p$, t, t);
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 12. Grants for the RLS runtime role (migration 010 pattern)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erppreflight_app') THEN
        GRANT SELECT ON knowledge_products, knowledge_editions, knowledge_releases,
                        knowledge_snapshots, knowledge_sync_runs, knowledge_change_events TO erppreflight_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_evidence_sources, knowledge_objects,
                        knowledge_object_aliases, knowledge_object_release_states, knowledge_relationships,
                        release_watches, release_watch_events, notifications, notification_preferences
                        TO erppreflight_app;
        GRANT USAGE, SELECT ON SEQUENCE knowledge_object_release_states_id_seq, knowledge_change_events_id_seq
                        TO erppreflight_app;
        -- Default privileges from 010 grant full DML on new tables; the global catalog
        -- tables are read-only for the runtime role (defense in depth on top of RLS).
        REVOKE INSERT, UPDATE, DELETE ON knowledge_products, knowledge_editions, knowledge_releases,
                        knowledge_snapshots, knowledge_sync_runs, knowledge_change_events FROM erppreflight_app;
        REVOKE USAGE, UPDATE ON SEQUENCE knowledge_snapshot_seq FROM erppreflight_app;
    END IF;
END $$;
